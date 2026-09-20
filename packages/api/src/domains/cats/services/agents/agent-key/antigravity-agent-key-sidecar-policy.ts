export type AgentKeyRegistryBackendKind = 'memory' | 'redis';

export interface AntigravityAgentKeySidecarPolicyOptions {
  backendKind: AgentKeyRegistryBackendKind;
  env?: Record<string, string | undefined>;
}

export function getAntigravityAgentKeySidecarSkipReason({
  backendKind,
  env = process.env,
}: AntigravityAgentKeySidecarPolicyOptions): 'disabled' | 'not-owner' | 'memory-backend' | null {
  if (env.CAT_CAFE_AGENT_KEY_SIDECAR_DISABLED === '1') return 'disabled';
  if (env.CAT_CAFE_PROVISION_GLOBAL_SIDECAR !== '1') return 'not-owner';
  if (backendKind === 'redis' || env.CAT_CAFE_AGENT_KEY_ALLOW_MEMORY_SIDECAR === '1') return null;
  return 'memory-backend';
}

export function shouldProvisionAntigravityAgentKeySidecar(options: AntigravityAgentKeySidecarPolicyOptions): boolean {
  return getAntigravityAgentKeySidecarSkipReason(options) === null;
}
