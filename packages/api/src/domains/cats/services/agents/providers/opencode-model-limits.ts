/**
 * OpenCode model `limit` construction — clowder#1481 (root cause) / #1208 (shape).
 *
 * OpenCode resolves a model's limit as `config ?? catalog ?? 0`, and its runtime
 * disables auto-compaction outright at `limit.context === 0`:
 *
 *   SessionCompaction.isOverflow = (t) =>
 *     cfg.compaction?.auto !== false && model.limit.context !== 0 && tokens >= budget
 *
 * So a model OpenCode cannot resolve (anything absent from `opencode models`)
 * never compacts at all, and a long tool loop grows its prompt until the
 * provider rejects it (`context_window_exceeded`). That is the research-cat
 * incident: the session was "not compressed" because the runtime never knew the
 * window — the guard had decided to seal, but nothing can stop a running CLI.
 *
 * `limit.output` is MANDATORY whenever `limit` is present (the model schema is
 * `Struct({ context: Finite, input?: Finite, output: Finite })`), so a
 * context-only block dies at config parse — the original #1208 incident.
 *
 * We therefore pair our authoritative context window with OpenCode's own
 * OUTPUT_TOKEN_MAX. The runtime caps a request at
 * `maxOutputTokens = Math.min(model.limit.output, 32000) || 32000`, so any value
 * >= 32000 collapses to the very fallback OpenCode already uses when no limit
 * exists: supplying it cannot change the output cap, it only revives compaction.
 *
 * Callers MUST pass a window only for model ids `opencode models` does not list.
 * Pinning a catalog-backed model would override its authoritative — sometimes
 * smaller — catalog output limit, which is exactly why #1208 stopped emitting
 * limits for those.
 */

export const OPENCODE_OUTPUT_TOKEN_MAX = 32_000;

export type OpenCodeModelLimit = {
  context: number;
  output: number;
};

/**
 * Build the `limit` block for one model, or `undefined` to leave OpenCode's own
 * catalog authoritative. A missing, zero, negative, or non-finite window never
 * produces a limit.
 */
export function resolveOpenCodeModelLimit(contextWindow: number | undefined): OpenCodeModelLimit | undefined {
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return undefined;
  }
  return { context: Math.floor(contextWindow), output: OPENCODE_OUTPUT_TOKEN_MAX };
}
