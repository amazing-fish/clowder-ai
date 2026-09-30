---
feature_ids: [F311, F286, F161, F159]
topics: [mcp, json-schema, regex, deepseek, acp, provider]
doc_kind: bug-report
created: 2026-10-01
---

# DSH MCP pattern portability and provider integration

The schema defect is reproduced and repaired in an isolated checkout of upstream
`b1fe2966fa0a97d1e3cd2e174ed59fd1477b4fc4`. Release and runtime acceptance remain pending.
Switching transports cannot make the same incompatible tool schema acceptable to a model endpoint.

## Observed failure and evidence boundary

The reported turn failed with `prompt_failure`, ACP `-32603`, and:

```text
Invalid schema for function 'mcp__cat-cafe-collab__cat_cafe_begin_evolution_preparation_work':
"^[a-z][a-z0-9-]*:[^\\s{}[\\]\"']+$" is not a "regex"
```

The unescaped opening bracket is legal inside a JavaScript character class.
Python `re` and `jsonschema` 4.26.0 also accept the original schema, so it would be
incorrect to say every strict JSON Schema validator rejects it. The independently
installed Python `regex` 2026.7.19 engine in `VERSION1` mode, which supports nested
sets, rejects it with `unterminated character set`. Escaping `[` preserves the JS
accepted language and removes that ambiguity.

```python
import regex
old = r'''^[a-z][a-z0-9-]*:[^\s{}[\]"']+$'''
new = r'''^[a-z][a-z0-9-]*:[^\s{}\[\]"']+$'''
regex.compile(old, regex.VERSION1)  # fails: unterminated character set
regex.compile(new, regex.VERSION1)  # succeeds
```

Installed DSH packages are `0.1.7-rc.2`. Their evidence chain is:

1. `dsh-mcp-client/lib/index.js`: `syncTools` passes MCP `inputSchema` to the tool's
   `parameters` without rewriting its patterns.
2. `dsh-llm-deepseek/lib/index.js`: `serialize` sends those parameters as
   `tools[].input_schema`; HTTP failures are translated to `LlmError`.
3. `dsh-acp/lib/index.js`: a failed agent turn is wrapped as ACP internal error
   `turn failed: ...`.

This supports an endpoint-side validation rejection rather than an ACP schema parser
failure. The precise remote validator and backend stack are **unverified**; no live
model request or production replay was performed. The strict-engine reproduction
does not identify that remote implementation.

## Failure-mode audit and repair

At the base revision, the production-source scan found 274 Zod `.regex()` calls in
120 files: 260 literal arguments and 14 dynamic arguments. There were 39 `u`-flag
literals. The two ambiguous patterns occur in six literal Zod calls; four additional
non-Zod validators use the same character class. The scan and the emitted-tool checks
found no additional Unicode-property or lookbehind problem in the MCP surface.

The canonical registry exposes 186 tools, with 98 pattern occurrences / 38 distinct
patterns. Its previously committed snapshot contains 178 tools, with 91 occurrences /
37 distinct patterns. Before repair, the snapshot's two ambiguous patterns account for
12 occurrences. After repair, every emitted and snapshot pattern compiles in Python
`regex.VERSION1`.

The shared ref module now owns one escaped non-payload character class and derives
exact-ref, prefix-ref, bare-id, and observation-join patterns. MCP definitions and
the API validators consume those patterns. Exact refs still require a nonempty id;
prefix refs still allow `kind:`. Brackets, braces, quotes and whitespace remain rejected.

The Node regression suite checks the **current canonical registry**, recursively
including nested union branches and `propertyNames`, plus the committed snapshot.
It uses JS Unicode parsing and explicit portability guards for nested classes,
lookbehind/named groups and Unicode-only escapes. These guards are a bounded portable
subset check, not a claim to emulate the remote endpoint. Python `regex` is only an
independent local audit; no Python dependency was added to the test suite.

Only the affected 12 snapshot patterns and 11 `inputSchemaDigest` fields were refreshed.
The pre-existing registry drift remains visible. A full regeneration also changes
unrelated entries and platform-dependent implementation digests, so it was excluded
from this bug's scope.

## ACP versus native provider: facts and decision packet

The instance's DSH variant has `clientId: acp`, uses stdio, starts the Node DSH CLI with
`--profile acp`, and enables MCP and multiplexing. In Clowder AI, ACP is already an
implementation of `AgentService`; provider identity and carrier are separate axes
(see F161). A different provider label alone changes no instruction authority.

| Concern | Current ACP path | Existing direct CatAgent path | Proposed DSH-specific provider |
| --- | --- | --- | --- |
| Clowder identity instructions | `AcpAgentService` prepends them to user prompt; `nativeInstructions` is empty | `CatAgentService` sends `body.system` | Must contribute native instructions to the addressed DSH session |
| Coding tools | Full DSH profile owns execution; ACP supplies MCP servers | `buildToolRegistry` exposes read/list/search only | Preserve DSH tools, permissions and MCP mounts |
| Tool schema | DSH forwards MCP schemas to the endpoint | Own read-only tool schemas | Requires the same portable MCP schemas |
| Continuity | Existing ACP pool/session/resume/cancel integration | Request-local Messages loop; no DSH persistent session | Integrate DSH durable sessions and host lifecycle without shared mutable instructions |
| Credentials | Existing account binding and ACP launch boundary | Existing API-key binding and Anthropic Messages protocol | Preserve account binding; evaluate DSH-specific account protocols |
| Delivery cost | Fix schema; existing integration remains | Cannot preserve DSH capability by changing configuration alone | New adapter, runtime composition, protocol tests and independent review |

DSH itself already assembles native system prompts. Its automation ACP interface
does not provide a per-turn system-instruction field. The installed SDK wire types
also expose only cwd/provider/model/effort/token settings at initialize and user
content at `session/prompt`; choosing that profile alone does not implement per-session
native instruction injection or mount the full coding/MCP profile.

**Recommendation:** finish the schema repair in the existing ACP integration. For the
next capability, design an opt-in DSH provider that retains the full harness and
contributes instructions to a session-scoped native prompt. A custom SDK/runtime
composition may be appropriate, but its native-prompt and MCP seams require a spike;
the current minimal SDK is not a drop-in migration. Replacing DSH with the existing
read-only CatAgent would fail the current coding-agent goal.

**Operator decision:** whether to invest in native instruction authority while keeping
the complete DSH coding experience, or retain the current standard ACP integration.
The tradeoff is stronger host control versus ongoing adapter/runtime maintenance.
No performance, price or model-quality improvement is claimed. Permission boundaries,
new first-party dependencies and provider contracts require separate scope approval;
none are changed by this repair.

Acceptance for that future provider must cover isolated native instructions for two
sessions, same/resumed identity, MCP list/call and errors, coding permissions, persistent
history, credential binding, cancellation, process exit, context/usage and host audit
signals. Live acceptance must use isolated development data and an opt-in variant.

## Provenance and confidence

Repository facts come from `AcpAgentService.ts`, `catagent/CatAgentService.ts`,
`catagent/catagent-read-tools.ts`, the current catalog projection, F161 and F159.
Installed package source is authoritative for the observed `0.1.7-rc.2` deployment;
the vendor's current docs are corroboration, not proof of an installed-version feature.
The vendor sources are first-party and have a product interest; conclusions here concern
inspectable protocol fields, not marketing claims or benchmarks.

- [DSH ACP contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)
- [DSH system-prompt composition](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/system-prompt/README.md)
- [DSH minimal SDK boundaries](https://deepseek-harness.github.io/deepseek-harness/en/guide/python-sdk)
- [JSON Schema regex portability guidance](https://json-schema.org/understanding-json-schema/reference/regular_expressions)

Confidence is high for the local schema defect and current injection paths. Exact
remote validator attribution and post-deployment recovery remain unverified. The
DSH-provider architecture is a recommendation, not a delivered or measured capability.

## Verification and remaining release blockers

- Shared and MCP TypeScript builds passed.
- Collective client/server types and API TypeScript compiled using package-local `tsc`.
- Shared focused suites: 37 tests passed, including two new reference-boundary tests.
- MCP focused suites and governance snapshot unit tests: 31 tests passed. The new
  canonical-pattern regression was observed RED before repair at 12 schema coordinates.
- API focused suites: 47 tests passed for owner routing, normalization and Microduck
  package/adapter behavior. Test environments used development Redis settings; these
  suites exercised fixtures rather than production data.
- Independent `regex.VERSION1` audit: all live and committed patterns compile.
- Changed-file Biome checks and `git diff --check` passed; existing warning-level
  complexity/unused-parameter diagnostics were not changed.

Commands include `pnpm --filter @cat-cafe/shared build`,
`pnpm --filter @cat-cafe/mcp-server build`, shared `vitest run` for the four focused
capability-evolution suites, Node tests for `mcp-schema-pattern-portability`, the four
MCP capability-evolution suites and `tool-governance-snapshot`, and API Node tests for
`measurement-decision-proof-normalized`, `eval-repair-owner-runtime-composition`,
`paw-feel-direct-repair-routing`, `paw-feel-direct-repair-outcome`, the Microduck football
loader/package and Microduck adapter.

The standard API build is blocked by the unchanged collective-client script
`rm -rf dist` on Windows. The governance CLI refuses this public repository because
attested bootstrap `265f7b998f7b8cae81d26d88db58351cf02b030d` is unavailable in its
history. Its Windows default dynamic loader also uses a drive path instead of a file URL.
Neither gate nor bootstrap attestation was weakened or rewritten. Full governance,
full public-suite/CI, upstream issue acceptance, cross-cat review, merge and runtime
acceptance have not been claimed complete.
