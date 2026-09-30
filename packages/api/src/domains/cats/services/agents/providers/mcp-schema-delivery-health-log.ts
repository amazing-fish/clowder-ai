/**
 * F153 MCP schema delivery health → log, warn-once per distinct state.
 *
 * The health event fires on every provider launch while the host capability
 * stays unknown (e.g. no attestation for this CLI version). The state rarely
 * changes, so repeating the warning per invocation was the main source of
 * warn-level terminal noise. The first occurrence of each distinct
 * (code, provider, carrier, hostVersion, profileId) warns; repeats go to
 * debug, so the full history is still available with LOG_LEVEL=debug.
 */

import type { LogFn } from 'pino';
import type { McpSchemaDeliveryHealthEvent } from './mcp-schema-delivery-capability.js';

export interface McpSchemaDeliveryHealthLog {
  warn: LogFn;
  debug: LogFn;
}

const MESSAGE = 'F153 MCP schema delivery capability unknown';

function stateKey(event: McpSchemaDeliveryHealthEvent): string {
  return [event.code, event.provider, event.carrier, event.hostVersion ?? '', event.profileId].join('\u0000');
}

export function createMcpSchemaDeliveryHealthLogger(
  log: McpSchemaDeliveryHealthLog,
): (event: McpSchemaDeliveryHealthEvent) => void {
  const warned = new Set<string>();
  return (event) => {
    const key = stateKey(event);
    if (warned.has(key)) {
      log.debug({ event }, MESSAGE);
      return;
    }
    warned.add(key);
    log.warn({ event }, MESSAGE);
  };
}
