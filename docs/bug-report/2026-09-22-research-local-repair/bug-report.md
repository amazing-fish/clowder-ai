---
topics: [opencode, responses, hydration, local-runtime]
doc_kind: note
created: 2026-09-22
---

# Research Responses and hydration recurrence in the local runtime

Tracking: https://github.com/amazing-fish/clowder-ai/issues/39

## Report and diagnosis

The operator reported the research agent failing after its initial text with
238/240 validation errors and OpenCode exit 1. The same conversation separately
reported a ChatContainer / ResizeHandle hydration mismatch. The requirement is
local repair and operator verification before any new PR; upstream operations
remain unapproved.

The two failures have independent technical causes and a shared delivery gap:
the running checkout lacks fixes already present on fork/main. No evidence ties
the hydration failure to the agent's reasoning or tool execution.

Runtime preflight, observed 2026-09-22:

```text
PORT=3004 (API); 3003 (web)
PID=57240 (API); 5928 (web)
START_TIME=2026-09-22T14:46:48Z (API); 14:46:51Z (web)
HEAD=7f462965a, branch dsh/fix-app-settings-persist-restart
TARGET_COMMIT=b8a81ec7666769e0a4b0fab80234a5e699b4bfaf (fork PR 37)
PROCESS_AFTER_TARGET=yes (target committed 2026-09-21T17:06:11Z)
LOG_EVIDENCE=3827 lines for API PID at the initial check
```

API command points to this checkout's `packages/api/dist/index.js`. Its provider
artifact was compiled at 14:46:38Z, but both source and dist lack the Responses
compatibility plugin. Thus a recent restart alone cannot load the fork fix.
The current conversation's second invocation logs `transient_cli_exit` retry.
Other-cat session drilldown was denied by the tool; it was not bypassed. Diagnosis
uses accessible thread messages, application logs, source, build artifacts and
fork PR truth. New live Discovery requests were not made in this repair.

PR #37 previously demonstrated that Discovery rejects assistant/output_text
history without the outer `type: message` discriminator; adding that field alone
changes the response from rejection to success. The first union-validation branch
`input.str` does not imply that the API only accepts strings. The observed error
matches this defect, and the local missing plugin is directly confirmed.

The local responsive hook reads matchMedia in a useState initializer: SSR false,
desktop hydration true. This changes the conditional panel/ResizeHandle DOM.
The existing fork implementation uses useSyncExternalStore with a false server
snapshot, preserving the server DOM during hydration.

## Local repair

Architecture cell: existing provider integration and responsive hook.
Map delta: none. No new transport, dependencies or data store.

- Reuse PR #37's exact Discovery fetch plugin and endpoint policy. Normalize only
  untyped assistant array-content messages; preserve tool/reasoning history,
  request headers, cancellation and streaming response.
- Add the plugin to custom Responses configs using the reviewed config predicate.
- Backport the non-retryable APIError termination and heading-only rejection
  diagnostic to the older local OpenCode service. Ending the loop runs spawnCli
  cleanup and prevents a subsequent generic exit-1 from triggering another retry.
  Retryable errors still recover. The older baseline has no pure-mode finalizer
  or read-only path; do not import the newer service architecture wholesale.
- Reuse the fork's exact useIsDesktop implementation and four regression tests.
- Reuse PR #37's platform-independent exact config-path assertion, after observing
  the existing POSIX-only assertion fail on Windows.

The plugin's URL/body/provider guards are copied from the reviewed implementation;
they restrict scope and preserve existing fetch behavior, not alternative transport
fallbacks. Runtime settings, startup configuration and persistent data are untouched.

## Validation

- Initial plugin tests fail because no plugin is generated. With corrected test
  model fixtures, the old service independently reproduces two errors versus one.
- After repair: service, compatibility, config template and config validation,
  **90/90 passed**, in a child process with isolated test HOME and Redis 6398 env.
- Hydration red: desktop SSR->hydrate produces recoverable hydration errors.
  Green: **4/4 passed**, including DOM/draft preservation and resize/unsubscribe.
- API TypeScript compilation passed. Changed-file Biome check has no errors;
  complexity/unused warnings remain. Full repository gate/CI are not claimed.
- Real Chrome 153.0.8010.48: isolated HTTP fixture imports the actual hook and
  ResizeHandle, server-renders then hydrates at 1280px, verifies original input DOM
  and pre-hydration draft, then resizes to 390px. Zero hydration/page errors.
  This is a component browser check, not a full ChatContainer/live-provider test.
- A separate reviewer independently passed API 90/90 and hook 4/4, read all changes,
  checked provider scope and generator cleanup, and reported no P1/P2/P3 findings.

Local evidence is in `reports/api-service-red.log`, `api-all-green.log`,
`web-red.log`, `web-green.log`, `api-build.log`, `browser-evidence.json` and
`browser-desktop.png` / `browser-mobile.png` in the repair worktree.

## Operator acceptance and delivery boundary

Only the selected source/tests and four provider modules' compiled artifacts are
prepared for the local running checkout, after checking that those paths have no
other edits. Preserve all unrelated dirty files; do not reset or switch its branch.
The API is the current session's parent and cannot be stopped by this agent.
The operator must restart the current instance to load the prepared API modules.

After restart, hard-refresh the desktop chat page and verify no hydration overlay.
In the original research thread, test a normal response, another turn, and a
read-only fixture-file tool call followed by another turn. Existing conversation
history is retained. Keep issue #39 open until operator verification.

No code push, new PR, upstream access, runtime restart or config edits are part of
this local repair. Both feature fixes already exist on fork; do not create a
duplicate feature PR merely to ship this older-checkout backport.

[Codex 官方/gpt-6-astra🐾]
