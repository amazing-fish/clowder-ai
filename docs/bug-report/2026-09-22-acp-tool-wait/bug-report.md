---
doc_kind: bug-report
created: 2026-09-22
topics: [acp, watchdog, tool-lifecycle]
---

# ACP tool-wait classification

Status: implementation and targeted validation complete; independent review pending.

## Report and evidence

The operator reported raw `{"type":"info","message":"acp ... (20s)"}`
chat messages. Both the author and DSH independently found that the running
clients use a single `pendingTool` boolean and ignore `completed` / `failed`
on `tool_call_update`. This proves a reachable stale-state path, not that every
observed warning was false. DSH found eight warnings preceded by an update,
but the logs omit status; those eight cannot be classified retrospectively.
The examined 16:00:47 warning in invocation `be13286f` followed an unfinished
tool call and is not evidence of a false positive.

## Fork baseline and scope

The implementation target is fork main `89deeeb25`, in the isolated checkout
`D:/AI/CodeX/Project/cat-cafe-acp-tool-wait`, branch `codex/fix-acp-tool-wait`.
The production checkout is a different branch and is not modified.

The fork already includes two relevant corrections:

- ACP idle/tool-wait warnings remain internal telemetry: the service does not
  emit their JSON as chat messages (`#1203`, commit `714475645`). Existing
  adapter regressions assert no liveness bubble while preserving real output.
- HTTP and stdio both enforce the configured idle TTL while tools are pending
  (`#1186`). Their cancellation and terminal error behavior must be retained.

Only the remaining wait-state classification needs new implementation. This
work is independent of Responses PR #37. No upstream operations, production
logging changes, runtime configuration changes, or API restart are authorized.

## Root cause and proposed state contract

`pendingTool` conflates multiple tool calls, permission requests, and legacy
events without a tool ID. Neither client reads final tool status. Replace
that bookkeeping with one shared per-prompt state implementation; extract the
existing final-status predicate so event transformation and waiting agree.

| Input | State transition |
| --- | --- |
| Tool call / progress with ID | Track that unfinished ID |
| `completed` / `failed` with ID | Remove only that ID; final replay cannot reopen it |
| Final event without ID | Clear only the anonymous legacy tool |
| Thought / metadata / interleaved text | Preserve explicitly tracked tool IDs |
| Permission request | Track the request ID separately from executing tools |
| Permission response / handler error | Settle only that permission request |
| End of prompt | Discard all prompt-local bookkeeping |

A single final event must not clear another running tool or pending permission.
Permission notification IDs must be assigned before dispatch, so synchronous
auto-approval cannot leave a synthetic wait behind. Preserve the legacy
text-completion inference only for tool events without a correlatable ID.

## Validation plan

Before implementation, run failing transport regressions for completed/failed
updates, single-event completed calls, concurrent tools with interleaved text,
flat/nested envelopes, and permission response timing. Assert the warning kind
after the transition and preserve terminal idle errors for stalled prompts.
Run the existing stdio, HTTP, transformer, and service suites after the fix.
Use isolated test HOME and Redis 6398; never connect tests to runtime data.

The already-fixed display path is validated by the existing service tests;
there is no new UI design or generic suppression rule in this repair.

## Acceptance

Red: the new real-parser/watchdog suite runs both transports with a mock agent.
After correcting the HTTP cancellation assertion to wait for request receipt,
42 tests produced 32 expected classification failures and 10 passing controls.
The failures cover final tool states, first-observed progress, concurrent work,
metadata, replay, and permission settlement. A first API build also reported a
missing workspace connector build; that is separate from these assertion failures.

Implementation uses `AcpToolWaitState` per prompt, retaining final IDs only for
that prompt to reject replay. `isFinalAcpToolStatus` is now the shared predicate
for the transformer and both transport watchdogs. Permission IDs are generated
before dispatch, pending events precede callbacks, and a decision/error removes
only that request. Stdio captures the owning listeners; HTTP closes over the
owning prompt. Completed prompts ignore late decisions. Deferred HTTP response
errors are consumed and delivered to the owning prompt instead of escaping as
unhandled rejections.

Green: workspace connector and API TypeScript builds exited 0. The final five
suites passed **197/197** (17 suites, no failures, skips or cancellations),
including 45 new transport regressions. Changed code/test files pass Biome and
`git diff --check`. A first combined run had a test-fixture teardown error: its
fake stdio peer incorrectly answered cancellation notifications after closing;
the fixture now follows JSON-RPC notification semantics. No product workaround
or weaker assertion was introduced.

The added transport cases also check late permission decisions after prompt
reuse and delayed HTTP response rejection. The latter is delivered as a prompt
error, with no unhandled rejection. No production or live-provider calls were
needed for these deterministic parser/watchdog paths. Independent review and
remote CI remain pending; no merge or deployment claim.

Reproduce after installing locked dependencies and building workspace deps:

```sh
pnpm --filter @cat-cafe/shared build
pnpm --filter @cat-cafe/collective-connector exec tsc
pnpm --filter @cat-cafe/api exec tsc
cd packages/api
node --import ./test/helpers/setup-cat-registry.js --test --test-timeout=30000 \
  test/acp/acp-tool-wait.test.js test/acp/acp-client.test.js \
  test/acp/acp-httpstream-client.test.js test/acp/acp-event-transformer.test.js \
  test/acp/gemini-acp-adapter.test.js
```

On Windows use an absolute `file:///.../setup-cat-registry.js` import URL.
The run used isolated HOME/USERPROFILE/XDG directories, `NODE_ENV=test`,
`CAT_CAFE_TEST_SANDBOX=1`, `REDIS_URL=redis://localhost:6398`, and unset runtime
root/data/carrier overrides. Local logs: `.tmp/acp-validation/final-*.log`.

Architecture cell: cats/services/agents/providers/acp; Map delta: none.
Why: waiting is prompt-local transport bookkeeping; both transports need one
state contract, with the existing final-status semantics shared by projection.
Canonical source: `packages/api/src/domains/cats/services/agents/providers/acp/acp-tool-state.ts#AcpToolWaitState`.
Consumer evidence: `rg -n 'AcpToolWaitState|isFinalAcpToolStatus' packages/api/src`
finds only the two clients, transformer, and canonical implementation.
Claim guard: `test/acp/acp-tool-wait.test.js` runs both transports, final status
and flat/nested envelopes, permission timing, prompt reuse, and stalled prompts
that must still throw `STREAM_IDLE_STALL` and send cancellation.
Characterization/contract tests: existing ACP client, HTTP client, transformer,
and Gemini adapter suites, including the fork's no-chat-bubble assertions.
Migration/restart/rollback: no persistent state or event storage schema changes;
each stream owns and discards its state. Deployment requires loading the reviewed
build through the separately authorized acceptance/runtime process.
Dogfood scope: internal telemetry classification only on this fork; real stream
parsers and timers are exercised by the transport suite. Provider calls are not
needed to reproduce deterministic event sequences; no production probing.
tips_exempt: Restores existing internal watchdog classification and preserves
the fork's existing no-bubble behavior; no new user action or capability.

[Codex 官方/gpt-6-astra🐾]
