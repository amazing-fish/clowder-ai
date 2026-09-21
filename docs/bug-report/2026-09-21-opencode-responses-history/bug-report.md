---
feature_ids: [F105, F212]
topics: [opencode, responses, compatibility, cli-diagnostics]
doc_kind: note
created: 2026-09-21
---

# OpenCode Responses continuation rejected by Discovery

## Requirement and diagnosis

The operator reported a configured OpenCode agent exiting twice with an unknown
CLI error and empty stderr, then requested a fix. The desired behavior is normal
multi-turn use, including continuing after a tool call, with useful diagnostics
when an upstream request really fails.

OpenCode 1.18.30 with `@ai-sdk/openai`, `Atria-Dawn-Preview`, and
`https://discovery-api.intern-ai.org.cn/v1` succeeded on the first turn. On resume,
the endpoint returned HTTP 400 `upstream_request_rejected` with 240 validation
errors. These errors were emitted on JSON stdout; stderr was empty. A subsequent
generic exit-1 event triggered a redundant Clowder retry of the same session.

The minimal failing history item was:

```json
{"role":"assistant","content":[{"type":"output_text","text":"OK"}]}
```

Adding only the outer `"type":"message"` changed the endpoint response from 400
to 200. Removing assistant history or using string content also returned 200,
but neither is appropriate for a fix that preserves conversation semantics.

## Implementation and boundaries

Architecture cell: identity-session (F032 provider integration); Map delta: none.
The existing OpenCode provider config and invocation termination paths retain
ownership. No new server, dependency, credential store, or transport protocol.

1. Add failing tests through the generated config for a bundled OpenCode plugin.
2. Use OpenCode's `config` hook to compose the provider's existing `options.fetch`.
   Only `@ai-sdk/openai` at the exact HTTPS Discovery origin and `/v1/responses`
   request path receives normalization. Other providers and request paths pass
   through. The plugin is attached only to custom API-key Responses configs.
3. Add `type: message` only to untyped assistant messages with array content.
   Preserve existing types, text, tool-call IDs/results, reasoning items,
   encrypted content, headers, cancellation, and the streaming Response object.
4. Honor the OpenCode APIError `isRetryable: false` marker in the existing
   permanent-failure path, yielding the upstream error and ending iteration
   before a generic exit event can trigger a second invocation. Unknown 400/422
   errors now identify the HTTP rejection and explain protocol compatibility.
   Existing classified error guidance remains authoritative.
5. Make the config-writer path assertion portable using the exact `join(...)`
   result; its previous slash-only regex failed on Windows.

OpenCode extension points were verified against its
[v1.18.30 plugin loader](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/plugin/index.ts)
and [provider fetch hook](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/provider/provider.ts).
The compatibility rule is endpoint-specific; a different regional endpoint is
not assumed to share this behavior without evidence. `opencode --pure` disables
external plugins and therefore also disables this compatibility hook.

## Validation

- Red: the new focused tests produced four expected failures (missing plugin
  and two errors emitted instead of one).
- Green: OpenCode service, config, and compatibility suites: 109 tests passed,
  zero failures. This includes existing transient-error recovery coverage.
- API TypeScript typecheck passed; repository-wide Biome check passed.
- Full `pnpm check` on Windows stops in the unchanged
  `scripts/check-f290-product-copy.test.mjs`: its POSIX expected path disagrees
  with Windows `path.join` output. The source and assertion are identical to
  base `5968c19ad`. This is not reported as a full-gate pass; Linux CI is needed.
- Actual CLI, isolated HOME/USERPROFILE/XDG directories and temporary cwd:
  fresh turn → resume → read a fixture file → resume after tool use all returned
  exit 0 with empty stderr. The last two turns both returned the fixture value.
  Config came from the built `generateOpenCodeRuntimeConfig`; the CLI loaded the
  compiled plugin directly and contacted the configured endpoint without a proxy.
- Unit tests preserve reasoning/encrypted items; the live scenario proves text
  and read-tool continuation, not every possible provider-native tool type.

Focused verification (build workspace dependencies first):

```sh
pnpm --filter @cat-cafe/api exec tsc
cd packages/api
node --import ./test/helpers/setup-cat-registry.js --test \
  test/opencode-responses-compat.test.js \
  test/opencode-agent-service.test.js \
  test/opencode-config-template.test.js
```

Use isolated test HOME and Redis 6398. On Windows, the `--import` preloader path
must be an absolute `file:///...` URL. No runtime account configuration or live
session data was modified for verification. The running API must load the
reviewed build before this generated-config change takes effect.

tips_exempt: This restores an existing provider path and improves its error
message; it introduces no new user action or capability.
