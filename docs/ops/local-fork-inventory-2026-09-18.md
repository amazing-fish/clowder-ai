---
feature_ids: []
topics: [fork-maintenance, windows, desktop]
doc_kind: note
created: 2026-09-18
updated: 2026-09-18
---

# 本机改动整理与 fork 交付记录

关联：amazing-fish/clowder-ai#3。同步基线：`b2927441baf81a83e4115c85211152e18b4947a6`。

本次只整理源码并提交 fork，不切换、重启或修改当前安装版，不修改运行配置或持久数据。原工作区、已有分支和 worktree 全部保留。汇总分支保留按主题组织的原作者提交及本次整合修复。

## 分支与未提交内容的去向

| 来源 | 处理 |
| --- | --- |
| `codex/fix-codex-cli-hf-download` | 提取 Windows Codex 安装路径、HF 端点/下载修复及 CardBlock 字体调整；适配当前上游执行策略 |
| `dsh/fix-app-settings-persist-restart-v2` | 采用明确 allowlist 的设置持久化修订及完整气泡开关状态提示 |
| `dsh/fix-app-settings-persist-restart` | 不重复采用较早的持久化实现，其修复意图由 v2 覆盖 |
| `backup/pre-rebase-26caae53d` | 保留为历史备份；已选择等价的较新提交，不重复导入 |
| `fix/desktop-im-autostart` | 提取桌面 IM 默认启动授权、显式关闭保留和热重载回归 |
| `fix/mcp-junction-entrypoints` | 提取共享真实文件身份检查及九个 MCP 入口接线 |
| `fix/windows-compaction-hooks` | 提取可移植压缩 hook、认证与安装/就绪检查；补充安装脚本自身的 junction 回归 |
| `fix/opencode-terminal-answer` | 已有 fork PR #2，保持其独立范围和原 base，不重复混入当前 PR |
| `codex/fix-codex-windows-exe-resolution` 中旧 PATH 选择 | 保留上游 `selectWindowsPathEntry` 的目录顺序契约，不恢复跨目录优先 `.cmd` 的旧实现 |
| `codex/eval-domains-current-opus`、另一分支重复 eval 提交、工作区九个 eval YAML 及路由测试 | 按用户本轮澄清排除：没有启用全部固定 opus 的机制；选择应支持自由指定或 AI 根据画像选择。本次不实现新的选择机制，也不为旧固定配置建 PR |
| 未提交 Eval Hub CRLF helper/test | 提取换行兼容修复；去掉无关 `findIndex` 改写，补充临时文件清理 |
| 未提交 desktop Taste Git-root 补丁 | 保留本地。含机器路径硬编码，且 `CAT_CAFE_TASTE_GIT_ROOT` 的消费者仅在安装版源码存在，当前 fork/upstream 基线没有对应 Taste 模块，不能作为独立有效修复合入 |
| 未跟踪 `tsconfig.install-build.json` | 保留本地，不提交。绝对路径直接写安装版 dist，不适合作为源码构建契约 |

## 整合过程中补充的修复

- CLI 定位器通过参数数组调用系统 locator；绝对可执行文件路径直接校验，避免 Windows `where` 把驱动器路径解析为 `path:pattern`，也避免通过 shell 拼接命令。
- Codex exec/resume 保留旧修复忽略用户配置的意图，同时保持上游 read-only/collective 的权限隔离参数。
- HF 配置文件可直连不能证明模型权重 CDN/CAS 也可直连。模型下载保留代理，不再基于 metadata probe 清空子进程代理。
- compaction 安装修复脚本也以真实文件路径识别入口，避免从桌面 scripts junction 启动时退出 0 却没有执行。

## 本轮验证

验证平台为 Windows；依赖通过锁文件从本地缓存安装。测试使用临时夹具，不读取生产账号配置、不启动真实模型 CLI、不连接生产 Redis。

| 验证 | 结果 |
| --- | --- |
| shared、finance、MCP、collective 依赖与 API 编译 | 通过。API 的原生 build wrapper 在 `rm -rf dist` 失败后，逐步执行剩余编译、扩展校验、catalog copy 和 recorder 检查通过 |
| Web `tsc --noEmit` | 通过 |
| 39 个变更 JS/TS/JSON 文件 Biome 检查 | 通过 |
| API 聚焦 8 个测试文件 | 54 通过、9 个平台条件跳过、0 失败 |
| Codex 基本执行/resume/沙箱/鉴权聚焦测试 | 9 通过 |
| desktop service manager、MCP junction、portable compaction hooks | 16 通过，包含本次新增修复脚本 junction 测试 |
| BubbleToggle 与 CardBlock | 22 通过 |
| HF PowerShell 代理环境夹具 | PASS，metadata 可直连时仍保留模型下载所需代理 |
| HF Git Bash 脚本契约 | 2 通过；系统默认 WSL shell 首次运行结果不作为通过证据 |

### 未通过或未完成的验证

- 完整 `pnpm check` 在上游 collective-client 的 Unix `rm` 清理命令失败，不能宣称完整 gate 通过。
- 宽范围 CLI/Codex 执行有 98 通过、9 跳过、6 失败：其中 5 条 Codex Windows 路径字符串断言失败，另有测试文件级失败；聚焦通过不能替代这一结果。
- Eval Hub read-model 全套在 `eval:memory` 的 `hasVerdict` 断言失败；当前公共仓库未检索到对应 markdown verdict fixture。CRLF 专项回归通过，不修改该断言来掩盖缺失样例。
- 未完成完整应用浏览器验收、真实模型下载、安装器打包/安装以及远端 CI。当前运行安装版不作为本分支的验证证据。
- 两个独立只读 reviewer 分别审查设置/IM 与 Windows/MCP/hooks/HF 范围。第一组无代码发现；第二组的代理清空、安装入口 junction 两项 P2 已修复并通过针对性测试。静态审查不是完整运行验收。

因此交付为 **Draft PR**，供检查源码与后续补齐门禁；不是 merge-ready，不合并、不关闭关联 Issue。
