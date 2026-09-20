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

18 focused tests pass across portable installation, registered commands with empty PATH,
callback rejection, authenticated compaction, epoch replay, cursor preservation and readiness.
The registered commands execute as real child processes against a real Fastify route using
isolated in-memory session stores. A separate run against the installed API modules and bundled
Node passes the affected session's degraded-handoff policy scenario.

The shared package TypeScript build and targeted readiness typecheck pass. Full desktop
installer execution, full repository CI and live conversation acceptance have not been run.
An independent reviewer approved after the packaging, Node-resolution, elevation and runtime
migration findings were resolved. macOS automatic installation is outside this Windows repair.

## Follow-up: launcher path spelling

After the operator applied the first repair and restarted, the same rejection recurred.
The configured Node path contained `apps`, while the actual API launch path contained `Apps`.
The first repair compared the complete command with a string derived from `process.execPath`;
Windows treats both executable paths as the same file, but that comparison returned false.
Running the same readiness probe with those two launcher spellings reproduced true/false.
The affected CLI transcript independently showed successful pre/post hooks and a successful
compact boundary before the API rejected it. The first probe was therefore insufficient to
claim that the live session was repaired.

The portable command now requires the same exact script and argument shape, and compares the
configured executable with the running Node using `realpathSync.native`. Directory junctions
and Windows casing resolve to the same executable; missing/different files, relative paths,
additional arguments, other scripts and chained commands remain rejected. Hook authentication,
the current-invocation observation, explicit opt-out and synchronous execution requirements remain.

The new alias test failed before the change and passes afterward, including both Windows path
casings and negative command checks. The 18-test run uses this checkout's compiled shared
package (an isolated resolver override, because the desktop dependency tree contains an older
shared package); it does not replace installed dependencies. Strict readiness typecheck,
format checks and the bundled Node probes with both launcher spellings also pass.
The API caches this module, so replacing the on-disk file requires an application restart
before live-session acceptance; no session records are reset or rewritten by this repair.


## PR #18：子目录工作目录回归

桌面项目可从 monorepo 子目录启动 Claude，而 readiness 在仓库根检查 carrier。
安装命令必须使用项目根限定的绝对脚本路径，不能让 `.claude/hooks` 相对于 Claude 的 cwd 解析。
readiness 同时校验 Node 和项目内脚本的文件身份；旧相对命令需要通过显式 installer repair 升级，
不会再被判为可用。修复器保留自定义命令，并支持受管命令的重复安装与 Node 路径更新。

真实路由回归从带空格和中文路径的嵌套子目录执行 pre/post，验证认证 observation 与 cold packet。
脚本路径中含 shell 展开字符（双引号、换行、`$`、反引号、`%`、`!`）时安装器会在写配置前明确拒绝，
避免生成会被 shell 重新解释的命令；本次源码修改不会自动改写正在运行的安装版配置。
