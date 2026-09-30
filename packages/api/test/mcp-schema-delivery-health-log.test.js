import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { createMcpSchemaDeliveryHealthLogger } = await import(
  '../dist/domains/cats/services/agents/providers/mcp-schema-delivery-health-log.js'
);

function recorder() {
  const calls = [];
  return {
    calls,
    log: {
      warn: (fields, msg) => calls.push(['warn', fields.event.code, msg]),
      debug: (fields, msg) => calls.push(['debug', fields.event.code, msg]),
    },
  };
}

const EVENT = {
  code: 'mcp_schema_delivery_attestation_unavailable',
  provider: 'anthropic',
  carrier: 'print_sdk',
  hostVersion: '2.1.285',
  profileId: 'full',
};

describe('F153 MCP schema delivery health log', () => {
  it('warns once per identical event, then repeats at debug', () => {
    const { calls, log } = recorder();
    const onHealthEvent = createMcpSchemaDeliveryHealthLogger(log);
    onHealthEvent(EVENT);
    onHealthEvent({ ...EVENT });
    onHealthEvent({ ...EVENT });
    assert.deepEqual(
      calls.map(([level]) => level),
      ['warn', 'debug', 'debug'],
    );
  });

  it('warns again when the state changes (code, carrier, host version, profile)', () => {
    const { calls, log } = recorder();
    const onHealthEvent = createMcpSchemaDeliveryHealthLogger(log);
    onHealthEvent(EVENT);
    onHealthEvent({ ...EVENT, code: 'mcp_schema_delivery_attestation_invalid' });
    onHealthEvent({ ...EVENT, carrier: 'app_server' });
    onHealthEvent({ ...EVENT, hostVersion: '2.1.286' });
    onHealthEvent({ ...EVENT, profileId: 'lean' });
    assert.ok(calls.every(([level]) => level === 'warn'));
    assert.equal(calls.length, 5);
  });

  it('keeps separate state per logger instance', () => {
    const a = recorder();
    const b = recorder();
    createMcpSchemaDeliveryHealthLogger(a.log)(EVENT);
    createMcpSchemaDeliveryHealthLogger(b.log)(EVENT);
    assert.equal(a.calls[0][0], 'warn');
    assert.equal(b.calls[0][0], 'warn');
  });
});
