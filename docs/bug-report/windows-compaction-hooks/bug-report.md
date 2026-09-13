# Windows desktop compaction carrier missing

Reported by the operator after a managed Claude session in the desktop workspace failed with
`authoritative_compaction_unsupported:hook_carrier_unavailable`.

## Reproduction and cause

The installed workspace had no `.claude/settings.json` or project compaction hook. The Windows
staging script, Inno manifest and Electron resource list shipped only `hooks/user-level`.
The provider received a typed compact boundary and correctly rejected the missing carrier.

Restoring the old shell hook alone is insufficient: Windows Node reports mode `100666` even
after `chmod(0755)`, so the existing executable-bit predicate rejects it. The affected host's
Git Bash also lacked `jq`. No session data loss was established by this investigation.

## Repair

- Ship the project hook directory through all desktop packaging manifests.
- Install the portable pre/post hooks during the elevated Windows post-install stage; leave
  user-level hook sync in the original-user stage.
- Invoke the known Node executable by absolute path, with no `jq`, `curl` or PATH dependency.
- Preserve custom settings and hooks, respect explicit hook disabling, back up changed settings,
  and replace managed registrations when the Node executable moves.
- Accept the readable Node carrier in the readiness predicate while retaining callback
  authentication, current-invocation observation and event-source checks. The legacy Unix
  executable-file check remains in place for the shell carrier.
- Post-compact output contains only the API-selected cold packet, never the raw digest.

`scripts/install-claude-compaction-hooks.mjs --project-root <workspace>` previews the change.
Run the same command with the API's Node executable and `--apply` to install, after the operator
has closed the application. Existing installations also need the rebuilt API readiness module.
Installing hook assets alone does not repair the old Windows predicate.

## Verification

17 focused tests pass across portable installation, registered commands with empty PATH,
callback rejection, authenticated compaction, epoch replay, cursor preservation and readiness.
The registered commands execute as real child processes against a real Fastify route using
isolated in-memory session stores. A separate run against the installed API modules and bundled
Node passes the affected session's degraded-handoff policy scenario.

The shared package TypeScript build and targeted readiness typecheck pass. Full desktop
installer execution, full repository CI and live conversation acceptance have not been run.
An independent reviewer approved after the packaging, Node-resolution, elevation and runtime
migration findings were resolved. macOS automatic installation is outside this Windows repair.
