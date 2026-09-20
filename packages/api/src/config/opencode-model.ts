export interface ResolvedOpenCodeModel {
  readonly providerName: string;
  readonly model: string;
}

export function parseOpenCodeModel(model: string): { providerName: string; modelName: string } | null {
  const trimmed = model.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= trimmed.length - 1) return null;
  return {
    providerName: trimmed.slice(0, slashIndex),
    modelName: trimmed.slice(slashIndex + 1),
  };
}

/**
 * Custom OpenAI-compatible endpoints carry their OpenCode provider type on the
 * account, not in the model id, so no vendor prefix can reveal it. These
 * families are mapped explicitly: without an entry a bare model id stays
 * unresolved, and the Hub save path rejects it (routes/cats.ts infers the
 * provider from the model name for opencode API-key accounts).
 */
const CUSTOM_ENDPOINT_PROVIDER_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  // Intern-AI Discovery API (research cat · Atria Dawn)
  [/^atria-dawn/, 'openai-responses'],
];

/** Infer the native OpenCode provider for a recognized bare model family. */
export function inferOpenCodeProviderFromModelName(model: string): string | undefined {
  const normalized = model.trim().toLowerCase();
  if (/^(gpt-|o[134](?:$|-|p)|davinci|text-|chatgpt)/.test(normalized)) return 'openai';
  if (/^claude/.test(normalized)) return 'anthropic';
  if (/^gemini/.test(normalized)) return 'google';
  if (/^(moonshot|kimi)/.test(normalized)) return 'kimi';
  if (/^deepseek/.test(normalized)) return 'deepseek';
  if (/^(glm|chatglm)/.test(normalized)) return 'zhipu';
  if (/^(qwen|tongyi)/.test(normalized)) return 'dashscope';
  if (/^minimax/.test(normalized)) return 'minimax';
  return CUSTOM_ENDPOINT_PROVIDER_PREFIXES.find(([pattern]) => pattern.test(normalized))?.[1];
}

/** Resolve one canonical provider/model identity for routing, capacity, and spawn config. */
export function resolveEffectiveOpenCodeModel(
  providerName: string | null | undefined,
  defaultModel: string | null | undefined,
): ResolvedOpenCodeModel | null {
  const explicitProvider = providerName?.trim() || undefined;
  const trimmedModel = defaultModel?.trim() || undefined;
  if (!trimmedModel) return null;

  const parsed = parseOpenCodeModel(trimmedModel);
  if (parsed) {
    if (explicitProvider && parsed.providerName !== explicitProvider) {
      return {
        providerName: explicitProvider,
        model: `${explicitProvider}/${trimmedModel}`,
      };
    }
    return {
      providerName: explicitProvider ?? parsed.providerName,
      model: trimmedModel,
    };
  }

  const nativeProvider = explicitProvider ?? inferOpenCodeProviderFromModelName(trimmedModel);
  if (!nativeProvider) return null;
  return {
    providerName: nativeProvider,
    model: `${nativeProvider}/${trimmedModel}`,
  };
}
