/**
 * Loaded by OpenCode, not the API process. Keep this module dependency-free.
 * Discovery rejects AI SDK assistant/output_text history without type: message.
 * Use the provider's fetch hook so auth, cancellation and SSE stay with OpenCode.
 */
type ProviderConfig = {
  npm?: string;
  options?: { baseURL?: string; fetch?: typeof globalThis.fetch };
};

function isDiscoveryUrl(value: string, path: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://discovery-api.intern-ai.org.cn' && url.pathname.replace(/\/$/, '') === path;
  } catch {
    return false;
  }
}

function normalizeBody(body: string): string {
  let request: { input?: unknown } | null;
  try {
    request = JSON.parse(body);
  } catch {
    return body;
  }
  if (!Array.isArray(request?.input)) return body;
  let changed = false;
  for (const item of request.input) {
    if (item?.role === 'assistant' && item.type === undefined && Array.isArray(item.content)) {
      item.type = 'message';
      changed = true;
    }
  }
  return changed ? JSON.stringify(request) : body;
}

export default async function discoveryResponsesCompatibility() {
  return {
    config(config: { provider?: Record<string, ProviderConfig> }) {
      for (const provider of Object.values(config.provider ?? {})) {
        const options = provider.options;
        if (provider.npm !== '@ai-sdk/openai' || !options?.baseURL || !isDiscoveryUrl(options.baseURL, '/v1')) continue;
        const originalFetch = options.fetch ?? globalThis.fetch;
        options.fetch = (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          if (init?.method === 'POST' && typeof init.body === 'string' && isDiscoveryUrl(url, '/v1/responses')) {
            const body = normalizeBody(init.body);
            if (body !== init.body) return originalFetch(input, { ...init, body });
          }
          return originalFetch(input, init);
        };
      }
    },
  };
}
