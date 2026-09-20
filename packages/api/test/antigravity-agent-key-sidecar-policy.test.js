import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('Antigravity sidecar startup diagnostics', () => {
  test('Redis dev process reports non-owner instead of memory storage', async () => {
    const policy = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );
    assert.equal(policy.getAntigravityAgentKeySidecarSkipReason({ backendKind: 'redis', env: {} }), 'not-owner');
  });

  test('explicit disable takes precedence over owner and memory opt-in', async () => {
    const policy = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );
    assert.equal(
      policy.getAntigravityAgentKeySidecarSkipReason({
        backendKind: 'redis',
        env: {
          CAT_CAFE_AGENT_KEY_SIDECAR_DISABLED: '1',
          CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1',
          CAT_CAFE_AGENT_KEY_ALLOW_MEMORY_SIDECAR: '1',
        },
      }),
      'disabled',
    );
  });

  test('memory warning requires ownership and absence of degraded opt-in', async () => {
    const policy = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );
    assert.equal(policy.getAntigravityAgentKeySidecarSkipReason({ backendKind: 'memory', env: {} }), 'not-owner');
    assert.equal(
      policy.getAntigravityAgentKeySidecarSkipReason({
        backendKind: 'memory',
        env: {
          CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1',
        },
      }),
      'memory-backend',
    );
  });

  test('diagnostic decisions preserve the original provisioning truth table', async () => {
    const policy = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );
    for (const backendKind of ['memory', 'redis']) {
      for (const disabled of [undefined, '0', '1']) {
        for (const owner of [undefined, '0', '1']) {
          for (const allowMemory of [undefined, '0', '1']) {
            const env = {
              CAT_CAFE_AGENT_KEY_SIDECAR_DISABLED: disabled,
              CAT_CAFE_PROVISION_GLOBAL_SIDECAR: owner,
              CAT_CAFE_AGENT_KEY_ALLOW_MEMORY_SIDECAR: allowMemory,
            };
            const expected = disabled !== '1' && owner === '1' && (backendKind === 'redis' || allowMemory === '1');
            assert.equal(policy.getAntigravityAgentKeySidecarSkipReason({ backendKind, env }) === null, expected);
            assert.equal(policy.shouldProvisionAntigravityAgentKeySidecar({ backendKind, env }), expected);
          }
        }
      }
    }
  });
});

describe('Antigravity agent-key sidecar provisioning policy', () => {
  test('memory backend does not provision the global sidecar by default', async () => {
    const { shouldProvisionAntigravityAgentKeySidecar } = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );

    const result = shouldProvisionAntigravityAgentKeySidecar({
      backendKind: 'memory',
      env: {},
    });

    assert.equal(result, false);
  });

  test('Redis backend does not provision the global sidecar unless this process owns it', async () => {
    const { shouldProvisionAntigravityAgentKeySidecar } = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );

    const result = shouldProvisionAntigravityAgentKeySidecar({
      backendKind: 'redis',
      env: {},
    });

    assert.equal(result, false);
  });

  test('Redis backend provisions the sidecar when the process explicitly owns the global sidecar', async () => {
    const { shouldProvisionAntigravityAgentKeySidecar } = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );

    const result = shouldProvisionAntigravityAgentKeySidecar({
      backendKind: 'redis',
      env: { CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1' },
    });

    assert.equal(result, true);
  });

  test('memory backend requires global owner plus explicit local degraded opt-in', async () => {
    const { shouldProvisionAntigravityAgentKeySidecar } = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );

    const withoutMemoryOptIn = shouldProvisionAntigravityAgentKeySidecar({
      backendKind: 'memory',
      env: { CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1' },
    });

    assert.equal(withoutMemoryOptIn, false);

    const result = shouldProvisionAntigravityAgentKeySidecar({
      backendKind: 'memory',
      env: {
        CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1',
        CAT_CAFE_AGENT_KEY_ALLOW_MEMORY_SIDECAR: '1',
      },
    });

    assert.equal(result, true);
  });

  test('disable flag overrides explicit global owner', async () => {
    const { shouldProvisionAntigravityAgentKeySidecar } = await import(
      '../dist/domains/cats/services/agents/agent-key/antigravity-agent-key-sidecar-policy.js'
    );

    const result = shouldProvisionAntigravityAgentKeySidecar({
      backendKind: 'redis',
      env: {
        CAT_CAFE_PROVISION_GLOBAL_SIDECAR: '1',
        CAT_CAFE_AGENT_KEY_SIDECAR_DISABLED: '1',
      },
    });

    assert.equal(result, false);
  });
});
