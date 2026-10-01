# Windows Collective Service startup recovery

Refs #1563. This candidate is stacked on #1559 (`f80d1f19924f4590c52a223c8b28f2ba3704daa4`), which supplies the native Windows ACL policy. The independent Service delta is reviewed against that commit. Upstream acceptance of #1563 and its bootstrap recovery policy is still required; the candidate remains Draft.

## Problem and ownership

The Service and GitHub App manifest writers renamed their state files, then flushed a directory handle. Native Windows rejects that flush with `EPERM`. The first Service state file therefore existed even though startup had failed and its plaintext bootstrap link had never been written. Restart could listen successfully while the Host timed out waiting for the missing link. Manifest reopening also rejected normal Windows mode bits as if they were Unix permissions.

The Service owns its state and bootstrap lifecycle. Shared node-only filesystem helpers now own private directory validation, private reads, and atomic writes. Connector reuses the moved Windows ACL validator through its existing import path. Browser-facing shared exports do not import Node filesystem or process APIs.

## Recovery boundary

- File fsync and same-directory rename remain mandatory. Unix also retains directory fsync and propagates failures. Windows omits only its unsupported directory flush.
- New Windows data directories receive a protected DACL for the current user, SYSTEM and Administrators. Existing directories are checked, never silently re-permissioned. Reparse points, untrusted owners/grants, null DACLs and inherited directory ACLs are rejected.
- The CLI writes an atomic private bootstrap link before committing its digest, using the configured public URL. Normal restarts validate and preserve an existing usable link.
- Missing, malformed, mismatched or expired links may be reissued only during local startup and only when the strict Service state is entirely pristine. Both bootstrap ownership markers must be absent, and every record collection, including legacy events and indexes, must be empty. Service instance identity and creation time remain unchanged. No HTTP reissue endpoint exists.
- Any unconsumed non-pristine state with an invalid link fails with `BOOTSTRAP_UNRECOVERABLE`. State and link remain unchanged. Consumed owner credentials are never reissued.
- A failed state commit after successful link replacement leaves a mismatch; the next pristine startup repairs it through the same validation path.
- Service startup failure diagnostics contain only PID, launch ID, status and a bounded error code. The Host matches both PID and its unique launch ID, so old diagnostics cannot be mistaken for the current child. It reports unrecoverable bootstrap errors instead of waiting for readiness timeout.
- The CLI requires a nonzero port for a durable bootstrap URL. The `startCollectiveServer` library still accepts port 0 for isolated HTTP tests. This deliberate CLI constraint is part of the candidate scope requiring maintainer review.

## Validation evidence

Native Windows, Node 24, isolated temporary stores:

- Before changes: all seven startup tests failed at the original directory `fsync` with `EPERM`.
- After changes: eight startup recovery tests passed, including preserved identity, valid link retention, old secret rejection after reissue, consumed owner preservation, byte-for-byte non-pristine refusal, and link-success/digest-failure recovery.
- Three GitHub App manifest tests passed, including credential and setup state reopening, expiry and concurrent replay.
- Three filesystem durability tests passed for Windows directory-flush exclusion, Unix flush failure propagation and file-flush failure before rename.
- Seven Connector native permission regressions passed after moving the helper, including unchanged insecure ACLs, insecure files, directory links, lost privacy and literal quoted paths.
- Five Host manager tests passed, including a real hidden Service child, rendered client response and identity-preserving restart in a private fixture. The PID/launch-ID failure diagnostic regression also passed.
- Shared build, Service and Connector compilation, and API TypeScript checks passed during implementation. Final exact-candidate checks are recorded in the PR.

The complete Service suite also passed through a managed command invoking the exact installed Vitest runner with an absolute Node path (exit 0, 178 seconds). The initial managed attempt could not find `pnpm` and did not execute tests; it is not test evidence. Changed-file Biome validation passed for 23 code/config files, and staged blobs were checked for LF line endings. Remote CI results are separate from these local checks. No user Service directory, state, permissions, runtime configuration or running service was changed.

Fallback scan flags boolean validation expressions as well as recovery paths. Here missing-file handling accepts only `ENOENT`; permission and other IO errors propagate. Malformed URLs are rejected before the pristine check. Temporary-file cleanup accepts `ENOENT` after successful rename. Windows/Unix dispatch selects distinct filesystem semantics, and the moved ACL helper preserves #1559's policy. These cases do not introduce cascading recovery or weaker authorization.

## Activation gate

Before any runtime activation, obtain an independent review of the exact candidate. Existing runtime directory ACLs must be inspected and any permission change must be separately authorized. Preserve a backup of Service state and its ACL before operator-approved recovery. Stop/restart the existing independent Service explicitly: restarting only the Host API may retain a detached child running the old implementation. Do not delete/reset the Service store, replace initialized credentials, or claim deployment from isolated tests. The operator owns the runtime restart.
