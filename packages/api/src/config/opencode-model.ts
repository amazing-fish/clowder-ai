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
 * Default OpenCode provider for a bare model id whose endpoint is chosen by
 * the member. The member's own `provider` always wins (`resolveEffectiveOpenCodeModel`
 * prefers it); this table only fills the gap when it is unset, where a
 * custom-endpoint id has no vendor prefix to infer from and would otherwise
 * stay unresolved. That gap is not cosmetic: the Hub save path (routes/cats.ts)
 * and `resolveEffectiveOpenCodeModel` both resolve bare ids through this
 * function, and the shared context-window catalog enumerates its keys through
 * it too.
 *
 * Entries are product defaults, not model properties. The same model id can be
 * served over several wire protocols, so an entry records which protocol the
 * Hub should assume by default for a bare id — not which protocol the model
 * "is".
 */
const CUSTOM_ENDPOINT_PROVIDER_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  // Atria-Dawn-Preview (issue #1508): the vendor serves this model over Chat
  // Completions, Messages and Responses. `openai-responses` is the assumed
  // default for a bare id, matching the vendor's Responses-based client
  // examples; a member that picks another protocol sets `provider` explicitly.
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
