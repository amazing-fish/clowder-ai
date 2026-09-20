/**
 * Context Window Size Catalog
 *
 * Static model → context window mapping shared between API and Web.
 *
 * API uses this as the last-resort fallback in Auto mode (after carrier
 * reports). Web uses it to preview draft compatibility: for a model in a
 * native vendor family, a catalog entry means Auto mode WILL resolve, so the
 * "needs Manual" warning should not fire.
 *
 * An entry is a CAPACITY fact only — it never selects a transport. A custom
 * endpoint id carries no vendor prefix, so a bare id still needs the member's
 * configured provider (one model id can be served over several wire
 * protocols; issue #1508). Lookups here are provider-agnostic:
 * `getContextWindowFallback` strips any provider prefix before matching, so
 * both `Atria-Dawn-Preview` and `openai-responses/Atria-Dawn-Preview` resolve.
 *
 * This module is pure static data with zero runtime dependencies.
 * Runtime-only helpers (carrier report correction, known-minimum floors)
 * stay in `packages/api/src/config/context-window-sizes.ts`.
 */

export const CONTEXT_WINDOW_SIZES: Readonly<Record<string, number>> = {
  // Claude (exact values from CLI, these are fallback)
  // Issue #1208: Anthropic confirmed Opus 4.6 / Sonnet 4.6 default to 1M
  // context windows without a beta header. Update stale 200K fallbacks.
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 1_000_000,
  'claude-sonnet-4-5': 200_000,
  'claude-haiku-4-5': 200_000,
  // Fable 5: native 1M context — the maximum is also the default (no [1m]
  // suffix needed). Also listed in KNOWN_MIN_CONTEXT_WINDOWS (API-only)
  // because stale CLIs (≤2.1.177) mis-REPORT it as 200K.
  'claude-fable-5': 1_000_000,
  // Codex/GPT
  'gpt-5.3': 128_000,
  'gpt-5.2': 128_000,
  'gpt-5.1-codex': 400_000,
  o3: 200_000,
  'o4-mini': 200_000,
  // MiniMax
  'MiniMax-M3': 1_000_000,
  // Zhipu / BigModel
  'glm-5.2': 1_000_000,
  'glm-5.2[1m]': 1_000_000,
  'minimax-m3': 1_000_000,
  // Gemini
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-3-pro': 1_000_000,
  'gemini-3.1-pro-preview': 1_000_000,
  // Atria-Dawn-Preview — public API from Shanghai AI Laboratory, served by
  // two first-party regions (issue #1508).
  //
  // Value 256_000: the model card lists "Context: 256K" and the official API
  // docs' model table says "256K tokens", and every machine-readable client
  // budget the vendor ships uses 256000 — Codex
  // `context_window`/`max_context_window` and Kimi `max_context_size`, both
  // documented as the model's real limit so client budgeting and compaction
  // work. This table is the same kind of client-side prompt budget, so it
  // follows the same number.
  //   https://huggingface.co/internlm/Atria-Dawn-Preview
  //   https://api.atria-asi.ai/docs
  //
  // Known discrepancy: the China-region gateway declares a higher
  // max_context_length of 262144 for this id (GET {baseUrl}/models on
  // https://discovery-api.intern-ai.org.cn/v1, observed 2026-09-20T19:27Z),
  // but the same entry also declares a 262144 output cap where the docs cap
  // output at 65536 — it over-declares. Budgeting on the lower documented
  // value costs ~2% of the window; budgeting on the higher one risks
  // over-limit requests at the ceiling if the documented value is the real
  // one.
  //
  // Scope: this entry lifts the prompt/history truncation ceiling only, so a
  // model bound through a custom endpoint stops collapsing to the 100K
  // unresolved guard. It does NOT enable auto-seal — catalog capacity stays
  // `actionable: false` (only manual/reported sources are actionable in
  // resolveContextCapacity) and opencode exposes no carrier contextBinding to
  // promote it. That distinction is the acceptance contract.
  //
  // Transport: this entry must not select an API adapter either. The id has no
  // native vendor prefix, so `inferOpenCodeProviderFromModelName` stays
  // `undefined` for a bare id and the member's configured `provider` decides
  // between Chat Completions / Messages / Responses. The capacity lookup above
  // still matches the id with or without a provider prefix.
  'Atria-Dawn-Preview': 256_000,
};

/**
 * Normalize provider-prefixed model IDs before lookup.
 *
 * The account routing path sets model strings like
 * `anthropic/claude-opus-4-6` or `openai-compat/gpt-5.3`.
 * Without normalization, lookups would miss the table entirely.
 */
export function stripProviderPrefix(model: string): string {
  const slashAt = model.lastIndexOf('/');
  return slashAt >= 0 ? model.slice(slashAt + 1) : model;
}

function lookupWithPrefixMatch(table: Readonly<Record<string, number>>, bare: string): number | undefined {
  if (table[bare] != null) return table[bare];
  // Prefix match (e.g. 'claude-opus-4-6-20260101' matches 'claude-opus-4-6')
  for (const [key, value] of Object.entries(table)) {
    if (bare.startsWith(key)) return value;
  }
  return undefined;
}

/**
 * Look up a model's known context window from the static catalog.
 *
 * Returns `undefined` when the model has no catalog entry — meaning
 * Auto mode cannot resolve from catalog alone and needs either a
 * carrier report or a Manual override.
 */
export function getContextWindowFallback(model: string): number | undefined {
  return lookupWithPrefixMatch(CONTEXT_WINDOW_SIZES, stripProviderPrefix(model));
}
