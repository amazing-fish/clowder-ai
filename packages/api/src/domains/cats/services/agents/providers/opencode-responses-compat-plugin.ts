/**
 * Loaded by OpenCode, not the API process. Keep this module free of external dependencies.
 * Discovery rejects AI SDK assistant/output_text history without type: message.
 * Use the provider's fetch hook so auth, cancellation and SSE stay with OpenCode.
 */
import { isDiscoveryUrl } from './opencode-responses-compat-policy.js';

type ProviderConfig = {
  npm?: string;
  options?: { baseURL?: string; fetch?: typeof globalThis.fetch };
};

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
        if (provider.npm !== '@ai-sdk/openai' || !options) continue;
        const originalFetch = options.fetch ?? globalThis.fetch;
        options.fetch = async (input, init) => {
          const url = input instanceof Request ? input.url : String(input);
          const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
          // Match the actual request; config hooks may still receive env placeholders.
          if (method === 'POST' && isDiscoveryUrl(url, '/v1/responses')) {
            const originalBody =
              typeof init?.body === 'string'
                ? init.body
                : input instanceof Request && init?.body == null
                  ? await input.clone().text()
                  : undefined;
            if (originalBody !== undefined) {
              const body = normalizeBody(originalBody);
              if (body !== originalBody) return originalFetch(input, { ...init, body });
            }
          }
          return originalFetch(input, init);
        };
      }
    },
  };
}
