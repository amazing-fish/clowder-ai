// @ts-check

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const mod = await import('../../dist/domains/cats/services/agents/providers/acp/dsh-native-l0.js');
const {
  DSH_DEFAULT_PERSONA_SUFFIX,
  buildDshL0PatchContent,
  computeDshL0Fingerprint,
  isDshAcpBootstrap,
  prepareDshNativeL0,
  resolveDshL0DriftPrefix,
  resolveDshNativeL0,
  stripReservedDshArgs,
} = mod;

const DSH_ARGS = ['C:/npm/node_modules/@deepseek-ai/dsh/bin/dsh.js', '--profile', 'acp'];

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-l0-test-'));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('dsh-native-l0', () => {
  it('detects DSH ACP bootstraps by binary name or package path, only in the acp profile', () => {
    assert.equal(isDshAcpBootstrap('dsh', ['--profile', 'acp']), true);
    assert.equal(isDshAcpBootstrap('C:/bin/dsh.cmd', ['--profile', 'acp']), true);
    assert.equal(isDshAcpBootstrap('node', DSH_ARGS), true);
    assert.equal(isDshAcpBootstrap('dsh', ['--profile', 'chat']), false);
    assert.equal(isDshAcpBootstrap('opencode', ['acp']), false);
    assert.equal(isDshAcpBootstrap('node', ['kimi.js', '--profile', 'acp']), false);
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

  it('strips user-supplied --patch in both separated and = forms', () => {
    assert.deepEqual(stripReservedDshArgs(['--profile', 'acp', '--patch', 'evil.json', '--patch=x.json', '-v']), [
      '--profile',
      'acp',
      '-v',
    ]);
  });

  it('is content addressed: same L0 → same patch path; changed L0 → new path', () =>
    withTmp((dir) => {
      const a = prepareDshNativeL0('dsh', DSH_ARGS, 'L0 v1', dir);
      const b = prepareDshNativeL0('dsh', DSH_ARGS, 'L0 v1', dir);
      const c = prepareDshNativeL0('dsh', DSH_ARGS, 'L0 v2', dir);
      assert.ok(a && b && c);
      assert.equal(a.patchPath, b.patchPath);
      assert.notEqual(a.patchPath, c.patchPath);
      assert.deepEqual(a.args, [...DSH_ARGS, '--patch', a.patchPath]);
      assert.equal(a.fingerprint, computeDshL0Fingerprint('L0 v1'));
      assert.match(readFileSync(a.patchPath, 'utf8'), /"personaPrefix": "L0 v1"/);
    }));

  it('falls back to the prepend path (null) when compile fails or bootstrap is not DSH', async () => {
    const errors = [];
    const failed = await resolveDshNativeL0(
      'dsh',
      'node',
      DSH_ARGS,
      async () => {
        throw new Error('compiler down');
      },
      (e) => errors.push(e),
    );
    assert.equal(failed, null);
    assert.equal(errors.length, 1);
    let called = false;
    const notDsh = await resolveDshNativeL0('kimi', 'kimi', ['acp'], async () => {
      called = true;
      return 'x';
    });
    assert.equal(notDsh, null);
    assert.equal(called, false, 'non-DSH members must not trigger an L0 compile');
  });

  it('drift check: current L0 → no prefix; changed L0 → current L0 prefix; compile error → keep spawn L0', async () => {
    const guard = (l0) => ({ fingerprint: computeDshL0Fingerprint('L0 v1'), compile: async () => l0 });
    assert.equal(await resolveDshL0DriftPrefix(guard('L0 v1'), 'dsh', 'u1'), undefined);

    const reasons = [];
    const prefix = await resolveDshL0DriftPrefix(guard('L0 v2'), 'dsh', 'u1', (r) => reasons.push(r));
    assert.equal(prefix, 'L0 v2');

    let seenUser;
    const failing = {
      fingerprint: 'x',
      compile: async (opts) => {
        seenUser = opts.userId;
        throw new Error('boom');
      },
    };
    assert.equal(await resolveDshL0DriftPrefix(failing, 'dsh', 'u9', (r) => reasons.push(r)), undefined);
    assert.equal(seenUser, 'u9');
    assert.deepEqual(reasons, ['stale', 'compile_failed']);
  });
});
