import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getAntigravityAgentKeySidecarSkipReason } from '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js';
import { RealGitRunner } from '../dist/domains/feat-trajectory/RealGitRunner.js';

for (const remote of [
  'https://github.com/example/clowder-ai.git',
  'git@github.com:example/clowder-ai.git',
  'ssh://git@github.com/example/clowder-ai.git',
  'https://github.com/example/clowder-ai/',
]) {
  test(`trajectory resolves its own origin: ${remote}`, async () => {
    const runner = new RealGitRunner('/checkout', async (args, cwd) => {
      assert.deepEqual(args, ['remote', 'get-url', 'origin']);
      assert.equal(cwd, '/checkout');
      return remote;
    });
    assert.equal(await runner.getGitHubRepo(), 'example/clowder-ai');
  });
}
for (const remote of [
  'https://gitlab.com/example/project.git',
  'D:/repos/project',
  'https://github.com/owner',
  'https://github.com/owner/repo/extra',
]) {
  test(`trajectory does not invent a GitHub repository for ${remote}`, async () => {
    const runner = new RealGitRunner('/checkout', async () => remote);
    assert.equal(await runner.getGitHubRepo(), null);
  });
}
test('missing origin has no inferred GitHub repository', async () => {
  const runner = new RealGitRunner('/checkout', async () => {
    throw new Error('No such remote');
  });
  assert.equal(await runner.getGitHubRepo(), null);
});
test('API startup wires origin inference and resolves the monorepo root', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /CAT_CAFE_REPO_ROOT\s*\|\|\s*findMonorepoRoot\(process.cwd\(\)\)/);
  assert.match(source, /CAT_CAFE_REPO_FULL_NAME\s*\|\|\s*\(await gitRunner.getGitHubRepo\(\)\)/);
});
test('development Redis sidecar skip reports ownership, not a memory backend', () => {
  assert.equal(getAntigravityAgentKeySidecarSkipReason({ backendKind: 'redis', env: {} }), 'not-owner');
  assert.equal(
    getAntigravityAgentKeySidecarSkipReason({ backendKind: 'redis', env: { CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1' } }),
    null,
  );
  assert.equal(
    getAntigravityAgentKeySidecarSkipReason({ backendKind: 'memory', env: { CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1' } }),
    'memory-backend',
  );
  assert.equal(
    getAntigravityAgentKeySidecarSkipReason({
      backendKind: 'redis',
      env: { CAT_CAFE_AGENT_KEY_SIDECAR_DISABLED: '1' },
    }),
    'disabled',
  );
});
