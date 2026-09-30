// @ts-check
/**
 * DSH native L0 end-to-end adapter regressions (review P1-2 / P2-1).
 *
 * Drives AcpAgentService with a recording pool and asserts, per invocation:
 *  - the pool key is scoped by (actual owner, current L0 revision) and its
 *    spawn args carry that owner's patch — owner A never reuses owner B's
 *    process, a changed L0 never reuses the stale one;
 *  - no owner / compile failure fails closed before any pool acquire;
 *  - every prepared launch (first attempt, busy retry, zero-event resume
 *    retry) records the native L0 in `nativeInstructions`;
 *  - the factory declares native routing iff the service launches natively.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

const base = '../../dist/domains/cats/services/agents/providers/acp';
const { AcpAgentService } = await import(`${base}/AcpAgentService.js`);
const { AcpProtocolError } = await import(`${base}/AcpClient.js`);
const { createAcpServiceForConfig } = await import(`${base}/AcpServiceFactory.js`);
const { DSH_NATIVE_L0_INJECTION_DECISION } = await import(`${base}/dsh-native-l0.js`);

const DSH_ARGS = ['C:/npm/node_modules/@deepseek-ai/dsh/bin/dsh.js', '--profile', 'acp', '--log-level', 'info'];
const BASE_KEY = { projectPath: '/proj', providerProfile: 'dsh' };
const patchDir = mkdtempSync(join(tmpdir(), 'dsh-l0-adapter-'));
after(() => rmSync(patchDir, { recursive: true, force: true }));

function makeClient({ resumedEvents = ['ok'], freshEvents = ['ok'], busyFirst = false } = {}) {
  let calls = 0;
  const client = {
    prompts: [],
    async newSession() {
      return { sessionId: `fresh-${++calls}` };
    },
    async loadSession(sessionId) {
      return { sessionId };
    },
    async setSessionConfigOption() {},
    cancelSession() {},
    async *promptStream(sessionId, text) {
      client.prompts.push({ sessionId, text });
      if (busyFirst && client.prompts.length === 1) {
        throw new AcpProtocolError(-32600, 'another turn is active', { code: 'turn.agent_busy' });
      }
      const events = sessionId.startsWith('fresh-') ? freshEvents : resumedEvents;
      for (const chunk of events) {
        yield { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } } };
      }
    },
    onCapacity() {},
    offCapacity() {},
    clearRecentCapacitySignal() {},
  };
  return client;
}

function makePool(client) {
  const pool = {
    acquired: [],
    remembered: [],
    async acquire(poolKey) {
      pool.acquired.push(poolKey);
      return { client, poolKey, release() {} };
    },
    rememberSession(poolKey, sessionId) {
      pool.remembered.push({ poolKey, sessionId });
    },
    sealSession() {},
  };
  return pool;
}

function makeAdapter(pool, compile, dir = patchDir) {
  return new AcpAgentService({
    catId: 'dsh',
    pool,
    poolKey: BASE_KEY,
    projectRoot: '/proj',
    providerName: 'dsh',
    modelName: 'deepseek-v4-flash',
    agentBusyRetryDelaysMs: [1],
    nativeL0Launcher: { command: 'node', baseArgs: DSH_ARGS, compile, patchDir: dir },
  });
}

async function run(adapter, userId, extra = {}) {
  const prepared = [];
  const messages = [];
  const options = {
    ...(userId ? { callbackEnv: { CAT_CAFE_USER_ID: userId } } : {}),
    beforeProviderLaunch: async (request) => {
      prepared.push(request);
      return { requestGenerationId: `g${prepared.length}`, generationOrdinal: prepared.length, sessionId: 's' };
    },
    ...extra,
  };
  for await (const msg of adapter.invoke('hi', options)) messages.push(msg);
  return { prepared, messages };
}

function assertNativeL0(request, body) {
  assert.equal(request.nativeInstructions.length, 1);
  assert.equal(request.nativeInstructions[0].body, body);
  assert.equal(request.nativeInstructions[0].injectionDecision, DSH_NATIVE_L0_INJECTION_DECISION);
  assert.ok(!request.message.body.includes(body), 'native L0 must not also be prepended to the user prompt');
}

describe('DSH native L0 adapter', () => {
  it('owner A and owner B get separate processes carrying their own L0', async () => {
    const pool = makePool(makeClient());
    const l0 = { alice: 'L0 alice', bob: 'L0 bob' };
    const adapter = makeAdapter(pool, async ({ userId }) => l0[userId]);
    assert.equal(adapter.injectsL0Natively(), true);

    const a = await run(adapter, 'alice');
    const b = await run(adapter, 'bob');
    const [keyA, keyB] = pool.acquired;
    assert.ok(keyA.nativeLaunch && keyB.nativeLaunch);
    assert.notEqual(keyA.nativeLaunch.scope, keyB.nativeLaunch.scope);
    const patchOf = (key) => key.nativeLaunch.args[key.nativeLaunch.args.indexOf('--patch') + 1];
    assert.notEqual(patchOf(keyA), patchOf(keyB));
    assert.deepEqual(keyA.nativeLaunch.args.slice(-2), ['--log-level', 'info'], 'patch stays in launcher region');
    assertNativeL0(a.prepared[0], 'L0 alice');
    assertNativeL0(b.prepared[0], 'L0 bob');
  });

  it('same-owner L0 drift moves to a new process scope instead of reusing the stale one', async () => {
    const pool = makePool(makeClient());
    let current = 'L0 v1';
    const adapter = makeAdapter(pool, async () => current);
    await run(adapter, 'alice');
    current = 'L0 v2';
    const second = await run(adapter, 'alice');
    assert.notEqual(pool.acquired[0].nativeLaunch.scope, pool.acquired[1].nativeLaunch.scope);
    assertNativeL0(second.prepared[0], 'L0 v2');
  });

  for (const [name, userId, compile] of [
    ['compile failure', 'alice', async () => Promise.reject(new Error('compiler down'))],
    ['missing owner', undefined, async () => 'L0'],
  ]) {
    it(`fails closed on ${name}: no acquire, no launch, typed error`, async () => {
      const pool = makePool(makeClient());
      const { prepared, messages } = await run(makeAdapter(pool, compile), userId);
      assert.equal(pool.acquired.length, 0);
      assert.equal(prepared.length, 0);
      const err = messages.find((m) => m.type === 'error');
      assert.equal(err?.errorCode, 'native_l0_unavailable');
      assert.equal(messages.at(-1).type, 'done');
    });
  }

  it('fails closed when the patch file cannot be written: typed error + done, no acquire/launch', async () => {
    // A regular file used as patchDir makes mkdir/write throw (ENOTDIR/EEXIST).
    const blocker = join(patchDir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const pool = makePool(makeClient());
    const { prepared, messages } = await run(
      makeAdapter(pool, async () => 'FIXTURE L0', blocker),
      'alice',
    );
    assert.equal(pool.acquired.length, 0);
    assert.equal(prepared.length, 0);
    const err = messages.find((m) => m.type === 'error');
    assert.equal(err?.errorCode, 'native_l0_unavailable');
    assert.match(err.error, /patch_unavailable/);
    assert.equal(messages.at(-1).type, 'done');
  });

  it('busy retry re-records the native L0 on the retried prepared launch', async () => {
    const pool = makePool(makeClient({ busyFirst: true }));
    const { prepared } = await run(
      makeAdapter(pool, async () => 'L0 busy'),
      'alice',
    );
    assert.equal(prepared.length, 2);
    assert.equal(prepared[1].boundaryReason, 'provider_busy');
    for (const request of prepared) assertNativeL0(request, 'L0 busy');
  });

  it('resume + zero-event retry stays on the owner-scoped key and records native L0', async () => {
    const pool = makePool(makeClient({ resumedEvents: [], freshEvents: ['retry reply'] }));
    const { prepared, messages } = await run(
      makeAdapter(pool, async () => 'L0 resume'),
      'alice',
      {
        sessionId: 'sess-dead',
      },
    );
    assert.ok(messages.some((m) => m.type === 'text' && m.content === 'retry reply'));
    assert.equal(prepared.length, 2, 'first attempt + zero-event fresh-session retry');
    for (const request of prepared) assertNativeL0(request, 'L0 resume');
    const scope = pool.acquired[0].nativeLaunch.scope;
    assert.ok(pool.remembered.length > 0);
    for (const { poolKey } of pool.remembered) assert.equal(poolKey.nativeLaunch?.scope, scope);
  });
});

describe('DSH native L0 factory → service declaration', () => {
  const config = (id) => ({
    id,
    name: id,
    displayName: id,
    color: { primary: '#111827', secondary: '#e5e7eb' },
    avatar: '/avatars/default.png',
    mentionPatterns: [`@${id}`],
    roleDescription: 'DSH test member',
    clientId: 'acp',
    defaultModel: 'deepseek-v4-flash',
    mcpSupport: false,
  });

  async function build(id, command, startupArgs) {
    const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-factory-'));
    const poolRegistry = new Map();
    let compiles = 0;
    try {
      const service = await createAcpServiceForConfig({
        projectRoot,
        profileId: id,
        effectiveModel: 'deepseek-v4-flash',
        config: config(id),
        acpConfig: { command, startupArgs },
        poolRegistry,
        l0CompilerFn: async () => {
          compiles++;
          return 'L0';
        },
        log: { info() {}, warn() {}, error() {} },
      });
      return { service, pool: poolRegistry.get(id), compiles };
    } finally {
      await Promise.all([...poolRegistry.values()].map((p) => p.closeAll?.()));
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }

  it('declares native routing for DSH acp without compiling or freezing any owner L0', async () => {
    const { service, pool, compiles } = await build('dsh-native', 'dsh', ['--profile', 'acp', '--log-level', 'info']);
    assert.equal(service.injectsL0Natively(), true);
    assert.equal(compiles, 0, 'registration must not compile a default-user L0');
    const baseArgs = pool.clientFactory(service.poolKey).config.args;
    assert.ok(!baseArgs.includes('--patch'), 'unscoped registry pool carries no L0');
    const scoped = { ...service.poolKey, nativeLaunch: { scope: 's', args: ['--profile', 'acp', '--patch', 'p'] } };
    assert.deepEqual(pool.clientFactory(scoped).config.args, ['--profile', 'acp', '--patch', 'p']);
  });

  it('does not declare native routing when the launcher region cannot be proven', async () => {
    const appRegion = await build('dsh-app-region', 'dsh', ['--log-level', 'info', '--profile', 'acp']);
    assert.equal(appRegion.service.injectsL0Natively(), false);
    const other = await build('not-dsh', 'mock-acp', ['--acp']);
    assert.equal(other.service.injectsL0Natively(), false);
  });
});
