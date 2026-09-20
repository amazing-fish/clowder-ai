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
 * Infer the native OpenCode provider for a recognized bare model family.
 *
 * Deliberately no custom-endpoint default (issue #1508, WRONG_LAYER): the same
 * model id can be served over Chat Completions, Messages and Responses, so no
 * wire protocol follows from a model name. The member's configured `provider`
 * is the authority for the transport; a context-window catalog entry is a
 * CAPACITY fact and must not pick an adapter. Unknown prefixes therefore stay
 * unresolved and the Hub save path keeps its validation error instead of
 * guessing one. The catalog-invariant test in
 * `test/opencode-config-template.test.js` pins this contract.
 */
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
  return undefined;
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
