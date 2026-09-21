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
   This applies to any APIError with that explicit marker, including auxiliary
   calls; it does not infer permanence for all HTTP 400 responses. For 400/422,
   classify only the error heading: validation details may quote arbitrary
   prompt text such as `quota` or `ENOENT`. Classified heading guidance remains
   authoritative.
5. Make the config-writer path assertion portable using the exact `join(...)`
   result; its previous slash-only regex failed on Windows.

OpenCode extension points were verified against its
[v1.18.30 plugin loader](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/plugin/index.ts)
and [provider fetch hook](https://github.com/anomalyco/opencode/blob/v1.18.30/packages/opencode/src/provider/provider.ts).
The compatibility rule is endpoint-specific; a different regional endpoint is
not assumed to share this behavior without evidence. `opencode --pure` disables
external plugins and therefore also disables this compatibility hook.

The service's own pure-mode paths keep that isolation boundary intact. For
Discovery Responses, a post-tool finalizer uses the existing deterministic
completion text (`responses_compat_requires_plugin`) without another CLI spawn;
it does not expose raw tool results. Read-only requests return an explicit
diagnostic before spawn, preserving any existing session. This includes fresh
requests, since a tool round trip can create assistant history within one turn.
Other endpoints and protocols keep their existing pure-mode behavior. Ordinary
continuation is supported; model-generated finalization and read-only execution
through this endpoint are not claimed to work in pure mode.

The fetch wrapper gates on the actual request URL, independent of config-hook
environment substitution timing. It supports both string `init.body` and a
cloned `Request` body without consuming the original request. SDK body formats
other than these are passed through unchanged; the verified SDK uses strings.

The fallback scanner flags syntax constructs in the plugin/policy. They are boundary
guards, not alternate transport paths: invalid URLs and non-JSON bodies pass
unchanged; absent provider config means no provider to visit; the provider/URL
predicate restricts scope; `options.fetch ?? globalThis.fetch` composes an
existing fetch implementation or uses the platform default. Removing them
would either throw on unrelated input or discard another plugin's fetch hook.
The request method default follows fetch's Request/init precedence. The
400/422 heading/name choice handles missing provider messages without treating
reflected request content as diagnostic evidence. Normalization belongs at this
request boundary, not in persisted chat history. The pure-mode guard reuses
the existing finalizer fallback instead of adding another transport path.

## Validation

Fork delivery: the operator requires merging into `amazing-fish/clowder-ai`
before any upstream submission, with operator approval for every upstream
operation. The three reviewed patches were cherry-picked onto fork main
`89deeeb25`; `git range-diff` reports all three patches unchanged. The fork's
existing model-limit and terminal-answer changes are retained. Its 350-line
template budget initially failed (352 lines); removing the obsolete writer
extraction note restores the budget without changing executable code or tests.
On this fork base, shared build and API TypeScript build passed, and the three
focused suites plus the fork's terminal-answer suite passed **129/129**.
The seven changed code/test files pass Biome after normalizing checkout CRLF.
These fork checks supersede the original-base counts below for local delivery;
the earlier live probes remain evidence for the unchanged compatibility code.

Fork cloud review identified a case-sensitive pure-mode guard although API-type
derivation accepts case-insensitive provider names. The shared guard now applies
the same lowercase comparison without changing the model passed to the CLI.
Before the fix, mixed-case and uppercase service tests failed in both read-only
preflight and post-tool finalization (four failures, lowercase controls passed).
After the fix, all four suites pass **133/133**, API `tsc` exits 0, and the changed
code/test files pass Biome. No new live endpoint probe was needed for this
pre-spawn boundary; these tests assert that the incompatible CLI never starts.

- Red: the new focused tests produced four expected failures (missing plugin
  and two errors emitted instead of one).
- Review delta red: five failures independently demonstrate both pure-mode
  holes, reflected-body misclassification, unresolved config placeholders,
  and Request-body normalization before the changes.
- Green: OpenCode service, config, and compatibility suites: 114 tests passed,
  zero failures. This includes existing transient-error recovery coverage.
- API TypeScript typecheck passed; repository-wide Biome check passed.
- Full `pnpm check` on Windows stops in the unchanged
  `scripts/check-f290-product-copy.test.mjs`: its POSIX expected path disagrees
  with Windows `path.join` output. The source and assertion are identical to
  base `5968c19ad`. This is not reported as a full-gate pass; Linux CI is needed.
- Initial actual CLI validation, isolated HOME/USERPROFILE/XDG directories and temporary cwd:
  ordinary fresh turn → resume → read a fixture file → resume after tool use all returned
  exit 0 with empty stderr. The last two turns both returned the fixture value.
  Config came from the built `generateOpenCodeRuntimeConfig`; the CLI loaded the
  compiled plugin directly and contacted the configured endpoint without a proxy.
- After the review delta, fresh and ordinary resumed turns again exited 0 with
  empty stderr. The read-tool invocation completed its file read, then hit the
  probe's 100-second timeout before final text (no APIError/400 emitted).
  With the isolated CLI process confirmed stopped, a subsequent invocation of
  the same isolated session exited 0, empty stderr, and returned the exact
  `fixture-value-314159` from that tool result. This proves post-tool history
  continuity; it is not reported as four uninterrupted successful invocations.
- That live sequence does not exercise the service's `--pure` finalizer. Its
  no-spawn behavior and read-only preflight are covered through service tests;
  the reviewer independently reproduced pure fresh success / pure resume 400
  on OpenCode 1.18.30 before the guards were added.
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
