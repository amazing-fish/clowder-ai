/** Shared endpoint boundary for the OpenCode fetch plugin and pure-mode guards. */
export function isDiscoveryUrl(value: string, path: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://discovery-api.intern-ai.org.cn' && url.pathname.replace(/\/$/, '') === path;
  } catch {
    return false;
  }
}

export function requiresDiscoveryResponsesPlugin(model: string, baseUrl: string | null | undefined): boolean {
  return (
    model.toLowerCase().startsWith('openai-responses/') && typeof baseUrl === 'string' && isDiscoveryUrl(baseUrl, '/v1')
  );
}
