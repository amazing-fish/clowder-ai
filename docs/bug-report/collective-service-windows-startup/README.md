# Windows Collective Service persistence and startup diagnosis

Refs #1563. Stacked on #1559 (`f80d1f19924f4590c52a223c8b28f2ba3704daa4`). Accepted scope and provenance are anchored in [accepted-scope.md](accepted-scope.md), which cites the maintained GitHub scope decision. The PR now excludes automatic bootstrap reissue; earlier recovery proposals are historical investigation, not its authority.

## Problem and ownership

Service and GitHub App manifest writers renamed state and then flushed a directory handle, which native Windows rejects with `EPERM`. First startup could therefore leave state without the initialization link. Restart then listened but the Host timed out waiting for that missing link. Manifest reopening also treated Windows mode bits as Unix permission evidence.

Service owns state and bootstrap delivery. The node-only shared helper owns private directory validation, private reads and atomic writes. Connector reuses the single moved Windows ACL validator through its original import entry. The shared browser entry does not import these Node APIs.

## Final behavior

- File fsync and same-directory rename remain mandatory. Unix also flushes the directory and propagates errors. Windows omits only the unsupported directory flush; its power-loss durability remains weaker than Unix directory fsync.
- New Windows directories receive a protected DACL for the current user, SYSTEM and Administrators. Existing ACLs are validated, never silently repaired. Reparse points, untrusted owners/grants, null DACLs and inherited directory ACLs are rejected.
- Unix upgrade impact: Host formerly applied chmod 0700 to an existing data directory. It now rejects group/other access without modifying permissions. A 0755 existing directory needs operator-controlled tightening; new Unix directories use 0700.
- First creation writes the private initialization link before committing the first digest. This is delivery-order repair of the original credential, not replacement of existing credentials. This implementation detail is called out for maintainer confirmation.
- Existing unconsumed credentials are only validated. Missing, malformed, mismatched or expired links always fail before listen with `BOOTSTRAP_UNRECOVERABLE`. Empty and nonempty instances use the same path. State, link and provider files remain unchanged. The message says automatic recovery is unsupported, data is preserved, and refers to #1563; it does not invent an owner recovery path for an uninitialized instance.
- Consumed bootstrap credentials are not rotated and do not require the old one-time link to remain. There is no pristine predicate, replacement-secret branch, reissue signal, or HTTP recovery endpoint.
- Startup failure diagnostics contain only PID, launch ID, failed status and one bounded code. Host matches both PID and launch ID, so stale records cannot impersonate the current child.
- Malformed diagnostic JSON is ignored as an unattributable residual record. A healthy child can reach ready without deleting it. A failed child atomically replaces it with its own fenced record. Permission/IO errors still fail. Authoritative state and link corruption are not ignored.
- CLI port 0 is rejected so the first link URL exists before digest commit. The HTTP server library retains port 0 for isolated tests; this CLI constraint is also called out for maintainer confirmation.

## Verification evidence

Native Windows, Node 24, private temporary stores and hidden child processes:

- Scope RED: four new unchanged-state refusal cases resolved with `bootstrapReissued=true` against the earlier combined candidate, confirming the out-of-scope behavior.
- Scope GREEN: ten startup cases and three manifest cases passed. Coverage includes valid restart retention; missing/malformed/mismatched/expired refusal with byte-for-byte preserved Service and provider files; nonempty orphan refusal; consumed owner retention; first-link failure before state creation; first-state failure after link delivery; and post-rename state failure reopening with the original credential.
- Host diagnostic RED/GREEN: damaged residual JSON formerly rejected provision, then healthy starts succeeded twice with unchanged diagnostic/state bytes. Three startup cases cover damaged/stale records followed by the current child's failure.
- Earlier unchanged-helper evidence: three shared durability tests and seven Connector native privacy cases passed, including Unix flush error propagation, unsafe ACL refusal and loss of directory privacy after opening.
- After the scope cut, complete Service regression passed via the managed Vitest runner (exit 0, 181 seconds); Service/API compilation, five Host manager tests including a real hidden Service child, three Host diagnostic tests, six changed-file Biome checks and whitespace validation passed. Earlier results are not substituted for this changed candidate.

Fallback handling is bounded: only ENOENT means a missing private file; URL syntax errors only invalidate a link; diagnostic SyntaxError only means absent attributable evidence; temporary-file cleanup only accepts ENOENT after rename. Platform dispatch chooses different filesystem semantics. There is no cascading credential recovery or weakened privacy check.

## Measured Windows cost

The unchanged shared writer was measured in an isolated fixture: five atomic writes took 985, 963, 976, 1002 and 964 ms; three authenticated `POST /api/events/human` calls took 1008, 996 and 980 ms. A fake auth provider made no external requests. This small local sample confirms roughly one second per mutation here, not a production throughput claim.

Directory checks remain per write. Caching at open would miss later ACL widening or directory replacement and violate existing lost-privacy checks. The check/write gap remains: revalidation narrows that window but does not eliminate it. A future faster validator must retain current checks. This PR introduces neither a stale permission cache nor an external dependency.

## Recovery research and runtime boundary

Recovery research remains under #1563 awaiting explicit maintainer authorization. Required design work includes provider history/credential eligibility, cross-process and cross-file exclusion, invalidation across bootstrap and provider setup, and honest post-rename/delivery failures. No recovery implementation remains in this PR.

This candidate does not repair an existing orphan instance. If its unconsumed link is missing, activation still fails, with an actionable error instead of a readiness timeout. No user directory, state, permissions, runtime configuration or running Service was changed. Any existing-directory ACL change and existing-instance recovery require separate operator decisions and preserved state/ACL backups. Stop/start Service explicitly when activation is authorized: an API restart can retain the detached old Service child. Never reset storage to obtain a fresh instance.
