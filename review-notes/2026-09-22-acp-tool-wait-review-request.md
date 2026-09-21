# ACP tool-wait review request

Author: Codex 官方 / gpt-6-astra. Reviewer requested: DSH / deepseek-v4-flash.
Review-Target-ID: codex-fix-acp-tool-wait
Branch: codex/fix-acp-tool-wait
Repository: amazing-fish/clowder-ai (fork only).
Worktree: D:/AI/CodeX/Project/cat-cafe-acp-tool-wait
Base: 89deeeb254e37bd7d02efbbd24b395811f49b946
Implementation commit: 9a74bb0cf39ae5e448296b46e2c63061ffbc70b5.
Review the final branch HEAD, which also includes this evidence-only note.

## Original requirement / What / Why

Operator in thread `thread_mua6fpn0blnrzpfv` reported recurring raw
`acp 正在等待工具返回 (20s)` messages. DSH independently confirmed that
completed/failed tool updates never clear the waiting flag; the eight old log
samples do not include statuses, so they cannot individually be called false.
The fork already hides watchdog JSON from chat and enforces tool idle TTL.
This patch fixes the remaining state classification in both ACP transports.

## Tradeoff

Replace a shared boolean with prompt-local IDs for tools and permission requests.
Final replay cannot reopen a tool; interleaved text only clears legacy anonymous
tool state. A completed tool cannot clear another tool or permission. Do not
infer execution from permission approval or add production diagnostic logging.
Permission callbacks belong to the prompt that dispatched them, including late
HTTP response failures. Existing cancellation and idle TTL behavior stays covered.

## Validation / architecture

32 expected classification failures before implementation (42 cases, 10 controls).
Final build: connector and API tsc exit 0. Final tests: **197/197**, 17 suites,
0 skipped/cancelled; 45 new transport cases. Biome and diff whitespace checks pass.
Reproduction commands and isolated environment are in the adjacent bug report.
Full `pnpm gate` is not claimed: current canonical SOP/classifier supports
risk-matched targeted evidence. Unchanged classifier on actual fork diff returns
targeted/standard for behavior risk, no base delta, no reusable full receipt.
Independent review remains mandatory. No runtime restart, config or data changes.

Architecture cell: cats/services/agents/providers/acp; Map delta: none.
Canonical source, consumer census, claim guards, rollback and scanner rationale:
`docs/bug-report/2026-09-22-acp-tool-wait/bug-report.md`.
Dogfood exemption: fork-internal watchdog telemetry; tests exercise actual
stdio/HTTP parsers and timers. No web code or user-facing API contract changes.

## Open / Next

Technical focus: synchronous/deferred permission callbacks, prompt reuse,
concurrent tools and final replay; confirm HTTP failures stay on the owning
prompt and event projection remains unchanged. No value decision is pending.

Please independently inspect the final SHA and run the five relevant suites in
an isolated HOME with Redis 6398. Return a clear verdict and P1/P2/P3 findings.
Do not access any upstream repository, modify production config, or restart API.
This review is independent of Responses PR #37 (already cloud-reviewed).

[Codex 官方/gpt-6-astra🐾]
