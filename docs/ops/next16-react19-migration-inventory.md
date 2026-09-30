# Next 16 / React 19 migration inventory

Measured on 2026-09-30 for [upstream issue #1549](https://github.com/zts212653/clowder-ai/issues/1549).
This is a draft migration and an inventory, **not a merge-ready upgrade**. No PR was opened.
At final status check, #1549 was `triaged` / `needs-maintainer-decision`, not accepted. The [maintainer's initial triage](https://github.com/zts212653/clowder-ai/issues/1549#issuecomment-5904457185) requests a complete version / peer matrix and support boundaries before implementation acceptance.

## Baseline and scope

- Base: `origin/main` at `30453795b78add8031056c1312db30c7e4157bb5`.
- Branch: `feat/next16-react19`, isolated checkout; the running checkout was not modified.
- Host: Windows, Node `24.18.0`, pnpm `9.15.4`; browser probes used headless Chromium.
- Versions resolved from the registry: Next `16.3.7`, React / React DOM `19.3.0`, both React type packages `19.3.0`.
- ESLint 9 / flat config, Turbopack, PWA replacement, and unrelated product fixes are excluded.
- Scope: 74 existing files changed, plus this inventory (75 files total).

## Mechanical migration

1. Updated web dependencies and lockfile. Added React 19 types at the workspace root so Next declaration files do not resolve the hoisted React 18 types from the separate Collective client. The Collective client retains its existing React 18 dependencies.
2. Ran `pnpm dlx @next/codemod@16.3.7 next-async-request-api packages/web/src/app --force`: 100 files examined, 10 changed, 90 untouched, zero codemod errors. Migrated async page props in the thread route, memory pages, signals pages, and overflow preview; adapted the thread route test.
3. Added `--webpack` to web dev/build, both start scripts, and all 17 browser harness files that launch Next directly. Kept `next.config.js` and `@ducanh2912/next-pwa` unchanged. The build wrapper now invokes the Next JavaScript entry through Node because spawning the `next` executable directly failed with `ENOENT` on Windows.
4. Replaced 12 zero-argument refs with explicit `undefined` initializers, made DOM ref annotations nullable, migrated global `JSX.Element` annotations to `React.JSX.Element`, and narrowed markdown image sources before string operations (React 19 also permits `Blob`). Replaced removed `Simulate.change` calls in two test files with native input events, preserving their assertions.
5. Accepted Next 16's TypeScript JSX / generated-type configuration. Generated route imports are restored to the production `.next/types` location after browser tests.

Next now generates local agent instruction files while testing. Those generated files were removed; this migration adds no permanent agent rules. pnpm also pruned stale lockfile entries for packages whose manifests are absent from this upstream checkout.

## TypeScript measurements

Command: `pnpm --filter @cat-cafe/web exec tsc --noEmit --pretty false`.

| Checkpoint | Errors | Files with errors |
| --- | ---: | ---: |
| Dependency bump, before codemod / type alignment | 785 | 391 |
| Async codemod and root React type alignment | 59 | 29 |
| Mechanical repairs | 0 | 0 |

Initial diagnostic counts: `TS2352` 465, `TS2322` 186, `TS2786` 112, `TS2345` 8, `TS2554` 12, `TS2305` 2. Type-resolution tracing confirmed mixed React 18 / 19 declarations; this was addressed at their common root rather than by casting hundreds of consumers.

The remaining 59 diagnostics were:

| Diagnostic | Count | Migration category |
| --- | ---: | --- |
| TS2322 | 31 | Ref nullability and explicit undefined states |
| TS2554 | 12 | `useRef` initializer required |
| TS2345 | 6 | Ref and image-source argument types |
| TS2339 | 5 | String methods on `string \| Blob` |
| TS2503 | 2 | Removed global JSX namespace |
| TS2305 | 2 | Removed React DOM test-utils `Simulate` export |
| TS2353 | 1 | Async route-prop test fixture |

## Verification results

| Check | Actual outcome |
| --- | --- |
| Web `tsc --noEmit` | PASS, zero diagnostics |
| `pnpm --filter @cat-cafe/web build` | PASS with webpack; 43 static pages, PWA service worker generated |
| `test:production-cache-policy` (canonical postbuild) | PASS, 2/2 |
| `pnpm --filter @cat-cafe/web test:guards` | PASS, custom color lint, 8 Node tests, and new UI emoji guard |
| Root `pnpm lint` | FAIL: Next 16 removed `next lint`; the script is intentionally left for the separate ESLint migration |
| Canonical web `test:unit` | BLOCKED before execution: upstream is missing `scripts/lib/process-resource-lease.mjs` imported by the test launcher |
| Direct Vitest run | 891 files passed, 10 files failed, one file hung; 7,343 tests passed, 14 failed, 11 results unreported |
| Direct Node unit scripts | 27 passed, 11 failed, 7 skipped (45 total); all 11 failures import the same missing lease module |
| Canonical web `test:browser` | BLOCKED in its wrapper: `spawnSync pnpm ENOENT` on Windows; lease module is also absent |
| Direct browser lane (same canonical test-file list) | 65 passed, 17 failed (82 total) |
| Direct F309 browser lane (same canonical test-file list) | 20 passed, 3 failed (23 total) |

The direct probes are additional evidence, not a claim that the canonical commands or CI passed. Their wrappers were not weakened or changed. Required artifact builds were run directly before browser probes. Playwright was installed temporarily in the fixture location expected by the public harness; all browser instances were headless, and Redis was limited to the isolated test service on 6398.

Build stamping warned that a clean build identity was unavailable while the draft was uncommitted. The build and cache checks still completed; this run is not a production deployment acceptance.

### Confirmed upgrade blocker: owner authorization loss

`src/components/capability-evolution/__tests__/evolution-reading.test.tsx` hangs at:

```text
clears live current claims on loss of owner read authorization across every consumer
```

The full Vitest run completed 901 of 902 files, leaving this worker busy. A focused rerun under the upgraded dependencies passed the first three tests and hung at the same fourth test. The verified test worker was stopped to prevent continued CPU / memory growth.

A snapshot of the baseline web source at `30453795b`, using the existing React `18.3.1` / Next `14.2.35` dependencies on the same host, passed all 12 tests in this file in 3.42 seconds. Both focused runs used one thread worker and verbose reporting. This establishes an upgrade-associated regression; the precise render / subscription mechanism is **not yet diagnosed**. No speculative F311 behavior change was made in this mechanical inventory.

Focused reproduction from `packages/web`:

```powershell
$env:NODE_ENV = 'test'
pnpm exec vitest run src/components/capability-evolution/__tests__/evolution-reading.test.tsx --pool=threads --maxWorkers=1 --reporter=verbose
```

Treat this as blocking before an upgrade PR can be ready for merge.

### Ordinary unit failures: baseline comparison

The same 14 failed test names reproduced in a baseline web-source snapshot with React 18 / Next 14. The comparison reran the 10 failed files, rather than claiming a full baseline suite pass: 358 passed, 14 failed.

| Baseline failing file | Failed tests |
| --- | ---: |
| `src/__tests__/color-token-audit.test.ts` | 2 |
| `src/components/__tests__/ApprovalDecisionCard.test.tsx` | 1 |
| `src/components/__tests__/chat-container-header-thread-indicator.test.ts` | 3 |
| `src/components/__tests__/f190-visual-contract.test.ts` | 1 |
| `src/components/__tests__/f232-artifact-view.test.ts` | 1 |
| `src/components/__tests__/f232-artifacts-detail.test.ts` | 1 |
| `src/hooks/__tests__/f232-artifact-content.test.tsx` | 1 |
| `src/hooks/__tests__/thread-projection-writer-boundary.test.ts` | 2 |
| `src/lib/story-player/__tests__/adaptive-pass-ball.test.ts` | 1 |
| `src/lib/visible-cafe/__tests__/inv6-no-concierge-paths.test.ts` | 1 |

Observed baseline causes include Windows path separators in source guards, inherited branding environment, missing public documentation fixtures, and existing assertions. These failures were kept visible and were not patched as part of the upgrade.

### Browser failures

The first direct browser lane completed all 82 tests. No React 18 browser comparison was performed, so the remaining browser failures must not all be attributed to the upgrade.

| File / journey | Failures | Observed failure |
| --- | ---: | --- |
| F290 assembly / embedded / owner-member / first-cat journeys | 7 | `EPERM` on directory `fsync` in unchanged Collective service persistence, before the page starts |
| F307 root reply at desktop / 390px | 1 | `Show sidebar` button timeout |
| F311 exploration workspace | 3 | Missing published replay / `公开归档` button timeout |
| F311 preparation workspace | 1 | Missing `docs/videos/f311-microduck-roadshow/pipeline/cortex/preparation/20260914/object-map.body.json`; absent from the base Git tree |
| F311 isolated Microduck owner reading | 1 | Expected material status timeout |
| Message actions density, touch device | 1 | Next dev error overlay intercepts tap |
| Message selection toolbar, 360px | 1 | Next dev error overlay intercepts click |
| HTML widget script live delivery / history | 1 | Content hash assertion mismatch |
| Final CLI signature pointer selection | 1 | Selection includes an additional unavailable-report status paragraph |

The error behind the Next overlay, other timeouts, and assertion mismatches remain unclassified. Preserve them for the next behavioral investigation rather than disabling the overlay or weakening assertions.

The separate F309 lane completed 23 tests: 20 passed, 3 failed. Two artwork-layout cases require the macOS-only `/usr/bin/sips` and fail before page execution on Windows. The GenOffice Settings / editor journey times out waiting for an HTTP response; this failure remains unclassified. Combined direct browser results: **85 passed, 20 failed, 105 total**.

## Handoff and next gates

- Inventory delivery is complete when this draft branch is pushed and the measurements are posted to #1549.
- Before merge-ready review: diagnose and fix the authorization-loss regression, classify remaining browser failures, and restore a runnable canonical test harness / missing public fixtures.
- The lint migration remains outside this inventory. Its target version and slicing require the requested compatibility matrix; ESLint 9 is not treated as an accepted target. The current root lint failure is explicit.
- The maintainer requires every mergeable intermediate state to retain build, types, lint, and browser gates. This draft therefore cannot be merged first with a promise to repair lint later; combine or reorder the implementation slices if necessary.
- No upstream acceptance, independent code review, CI success, merge, deployment, or feature closure is claimed by this inventory.
- Version-specific references: [Next 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16), [official codemods](https://nextjs.org/docs/app/guides/upgrading/codemods).
