// @ts-check

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const mod = await import('../../dist/domains/cats/services/agents/providers/acp/dsh-native-l0.js');
const {
  DSH_DEFAULT_PERSONA_SUFFIX,
  DSH_NATIVE_L0_INJECTION_DECISION,
  buildDshL0PatchContent,
  buildDshNativeInstructions,
  computeDshL0Fingerprint,
  isDshAcpBootstrap,
  prepareDshNativeL0,
  resolveDshInvocationLaunch,
} = mod;

const SCRIPT = 'C:/npm/node_modules/@deepseek-ai/dsh/bin/dsh.js';
const DSH_ARGS = [SCRIPT, '--profile', 'acp'];
const BASE_KEY = { projectPath: '/proj', providerProfile: 'dsh' };

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-l0-test-'));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('dsh-native-l0', () => {
  it('detects DSH ACP bootstraps only when the launcher region boots the acp profile', () => {
    assert.equal(isDshAcpBootstrap('dsh', ['--profile', 'acp']), true);
    assert.equal(isDshAcpBootstrap('C:/bin/dsh.cmd', ['acp']), true, 'positional profile expands to --profile');
    assert.equal(isDshAcpBootstrap('node', DSH_ARGS), true);
    assert.equal(isDshAcpBootstrap('dsh', ['--profile', 'chat']), false);
    assert.equal(isDshAcpBootstrap('opencode', ['acp']), false);
    assert.equal(isDshAcpBootstrap('node', ['kimi.js', '--profile', 'acp']), false);
    // `--profile acp` after the launcher boundary is an app arg, not the launcher profile.
    assert.equal(isDshAcpBootstrap('dsh', ['--', '--profile', 'acp']), false);
    assert.equal(isDshAcpBootstrap('dsh', ['--log-level', 'info', '--profile', 'acp']), false);
    assert.equal(isDshAcpBootstrap('dsh', ['--profile', 'acp', '--dump-config']), false);
    assert.equal(isDshAcpBootstrap('dsh', ['plugin', '--profile', 'acp', 'add', 'x']), false);
  });

  it('builds a system-prompt patch that keeps DSH persona suffix', () => {
    const content = buildDshL0PatchContent('  I am 深深.  ');
    assert.ok(content);
    assert.deepEqual(JSON.parse(content), [
      { id: 'system-prompt', config: { personaPrefix: 'I am 深深.', personaSuffix: DSH_DEFAULT_PERSONA_SUFFIX } },
    ]);
  });

  it('refuses the native channel for empty L0 or L0 that DSH would interpolate', () => {
    assert.equal(buildDshL0PatchContent('   '), null);
    assert.equal(buildDshL0PatchContent('path is {{cwd}}'), null);
  });

  it('inserts the host patch at the launcher boundary, before `--` and app args', () =>
    withTmp((dir) => {
      const plain = prepareDshNativeL0('dsh', 'node', DSH_ARGS, 'L0', dir);
      assert.ok(plain);
      assert.deepEqual(plain.args, [...DSH_ARGS, '--patch', plain.patchPath]);

      const sep = prepareDshNativeL0('dsh', 'node', [...DSH_ARGS, '--', '--patch', 'app.json'], 'L0', dir);
      assert.ok(sep);
      assert.deepEqual(sep.args, [...DSH_ARGS, '--patch', sep.patchPath, '--', '--patch', 'app.json']);

      const app = prepareDshNativeL0('dsh', 'node', [...DSH_ARGS, '--log-level', 'info'], 'L0', dir);
      assert.ok(app);
      assert.deepEqual(app.args, [...DSH_ARGS, '--patch', app.patchPath, '--log-level', 'info']);
    }));

  it('strips caller launcher --patch (both forms) but leaves app-region tokens untouched', () =>
    withTmp((dir) => {
      const args = ['--profile', 'acp', '--patch', 'evil.json', '--patch=x.json', '-v', '--patch', 'app.json'];
      const b = prepareDshNativeL0('dsh', 'dsh', args, 'L0', dir);
      assert.ok(b);
      assert.deepEqual(b.args, ['--profile', 'acp', '--patch', b.patchPath, '-v', '--patch', 'app.json']);
    }));

  it('is content addressed: same L0 → same patch path; changed L0 → new path', () =>
    withTmp((dir) => {
      const a = prepareDshNativeL0('dsh', 'node', DSH_ARGS, 'L0 v1', dir);
      const b = prepareDshNativeL0('dsh', 'node', DSH_ARGS, 'L0 v1', dir);
      const c = prepareDshNativeL0('dsh', 'node', DSH_ARGS, 'L0 v2', dir);
      assert.ok(a && b && c);
      assert.equal(a.patchPath, b.patchPath);
      assert.notEqual(a.patchPath, c.patchPath);
      assert.equal(a.fingerprint, computeDshL0Fingerprint('L0 v1'));
      assert.equal(a.body, 'L0 v1');
      assert.match(readFileSync(a.patchPath, 'utf8'), /"personaPrefix": "L0 v1"/);
    }));

  it('invocation launch compiles for the actual owner and scopes the pool by (owner, L0 revision)', () =>
    withTmp(async (dir) => {
      const seen = [];
      const l0ByOwner = { alice: 'L0 alice', bob: 'L0 bob' };
      const launcher = {
        command: 'node',
        baseArgs: DSH_ARGS,
        patchDir: dir,
        compile: async ({ catId, userId }) => {
          seen.push({ catId, userId });
          return l0ByOwner[userId];
        },
      };
      const a = await resolveDshInvocationLaunch(launcher, BASE_KEY, 'dsh', 'alice');
      const b = await resolveDshInvocationLaunch(launcher, BASE_KEY, 'dsh', 'bob');
      assert.ok(a.ok && b.ok);
      assert.deepEqual(seen, [
        { catId: 'dsh', userId: 'alice' },
        { catId: 'dsh', userId: 'bob' },
      ]);
      assert.notEqual(a.poolKey.nativeLaunch.scope, b.poolKey.nativeLaunch.scope);
      assert.notDeepEqual(a.poolKey.nativeLaunch.args, b.poolKey.nativeLaunch.args);
      assert.ok(!a.poolKey.nativeLaunch.scope.includes('alice'), 'scope must not leak the raw owner id');
      assert.equal(a.poolKey.projectPath, BASE_KEY.projectPath);

      l0ByOwner.alice = 'L0 alice v2';
      const a2 = await resolveDshInvocationLaunch(launcher, BASE_KEY, 'dsh', 'alice');
      assert.ok(a2.ok);
      assert.notEqual(a2.poolKey.nativeLaunch.scope, a.poolKey.nativeLaunch.scope, 'drift → new process scope');
    }));

  it('fails closed without owner, on compile failure, or on an unsafe L0', async () => {
    const launcher = (compile) => ({ command: 'node', baseArgs: DSH_ARGS, compile });
    const ok = launcher(async () => 'L0');
    assert.deepEqual(await resolveDshInvocationLaunch(ok, BASE_KEY, 'dsh', undefined), {
      ok: false,
      reason: 'owner_missing',
    });
    assert.equal((await resolveDshInvocationLaunch(ok, BASE_KEY, 'dsh', '  ')).ok, false);
    const boom = await resolveDshInvocationLaunch(
      launcher(async () => {
        throw new Error('compiler down');
      }),
      BASE_KEY,
      'dsh',
      'alice',
    );
    assert.equal(boom.ok, false);
    assert.equal(boom.reason, 'compile_failed');
    const unsafe = await resolveDshInvocationLaunch(
      launcher(async () => 'x {{cwd}}'),
      BASE_KEY,
      'dsh',
      'alice',
    );
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.reason, 'patch_unavailable');
  });

  it('native instructions carry the exact L0 body plus patch binding evidence', () =>
    withTmp((dir) => {
      const binding = prepareDshNativeL0('dsh', 'node', DSH_ARGS, '  L0 body  ', dir);
      assert.ok(binding);
      const [instruction, ...rest] = buildDshNativeInstructions(binding);
      assert.equal(rest.length, 0);
      assert.equal(instruction.body, 'L0 body');
      assert.equal(instruction.injectionDecision, DSH_NATIVE_L0_INJECTION_DECISION);
      assert.deepEqual(
        instruction.sourceRefs.map((r) => r.ref),
        ['registry:cat-cafe-owned', `dsh-launcher-patch:l0-sha256:${binding.fingerprint}`],
      );
    }));
});
