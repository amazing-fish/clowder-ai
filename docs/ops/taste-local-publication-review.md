---
feature_ids: [F221]
topics: [taste, desktop, fork-contribution]
doc_kind: note
created: 2026-09-18
updated: 2026-09-20
---

# Taste 桌面 checkout 与本地发布修改审批提案

状态：待审批；这是安装版已有行为的整理及迁移建议，不是生效政策，也不启用任何发布功能。

## 既有隐私与发布边界

本提案遵守 [F221 Taste Lane 的 AC-A5 和 KD-11](../features/F221-taste-lane.md)：`privacy: public` 只表示向**私有 Clowder AI 家仓**共享，不表示向互联网公开。Taste 正文、vignette、index、proposal payload 和私人证据不得进入开源 `clowder-ai`、它的公开 fork、Issue/PR、附件或 outbound open-source sync。

必须区分两个流程：Taste 内容审批与发布只面向明确授权的私有家仓；通用功能源码的贡献才使用开源 fork 的 Issue/PR。后者只能携带实现代码、合成测试夹具及不包含私人内容的说明，不能用源码贡献授权替代 Taste 内容发布授权。Taste `private` 内容仍留在原有私人存储边界，不因本提案获得 Git 发布权限。

## 已有修改及来源

安装版 0.13.0 的主体源码最接近公共历史 `01c58feb40fab2a75016a9a8d290c87f6776d9a0`；没有安装包精确构建 SHA 的证明。下列局部修改未命中可达 Git 历史：

| 来源文件 | 现有本机行为 | 本次处理 |
| --- | --- | --- |
| `desktop/service-manager.js`（部署在 Electron app 内） | 猜测本机绝对路径、排除旧路径和运行目录、用 origin URL 子串判断 checkout；找到后默认设置 local-only=1 | 不将机器路径和自动启用策略迁入源码 |
| `packages/api/src/config/env-registry.ts` | 注册 `CAT_CAFE_TASTE_LOCAL_ONLY` | 与 locator 变量分开审批 |
| `packages/api/src/domains/taste/services/TasteRepository.ts` | 抽取 `findMainWorktreePath()` 供 publisher 直接定位 main | 本次仅记录，不激活 |
| `packages/api/src/domains/taste/services/GitTastePublisher.ts` | clean 检查后向 main 工作区 materialize/add/commit；失败尝试 reset/checkout/remove | 建议不原样采纳 |

独立的 `CAT_CAFE_TASTE_GIT_ROOT` locator 见 #22 / #23。它定位的是 Taste 发布所用的私有家仓 checkout，而不是开源源码 fork；现有 publisher 会继承该 checkout 的 origin，因此路径存在不等于目标已获发布授权。桌面启动器已经继承启动进程环境，显式 locator 不需要硬编码目录发现；环境修改也不会自动影响已启动程序。

## 对用户流程的影响

现有 local-only 模式没有 clone/fetch/push，却会修改主工作区并生成提交。这个结果不能表示 Taste 已持久发布到私有家仓 `origin/main`。自动把“origin 不可推送”转成“写本机 main”，会改变既有隔离发布与恢复契约；也不能转向公开 fork 绕过失败。

安装版 `taste-git-root.test.js` 只覆盖路径定位与默认远端 publisher，没有覆盖 local-only 的失败、幂等或并发场景。当前已存在的硬编码路径、自动开启条件和异常回滚不能作为通用实现直接迁入。

## 建议的后续方向，等待审批

1. Taste checkout 只接受明确选择，并确认其远端为获授权的私有家仓；无效路径、公开目标或无法确认目标身份及授权时，在写入内容前拒绝，不猜其他目录，不以 URL 子串替代仓库身份、可见性和权限验证。
2. 在私有家仓边界内沿用既有 typed proposal 审批、隔离 publisher 与 checkpoint 恢复。离线时仅保留原有受保护存储内的待发布状态，不能声称已发布；私有家仓 `origin/main` publication 仍是既有完成终态，不额外要求公开 fork PR。
3. 通用功能源码的 Issue、PR、目标分支及远端必须明确；公开材料使用合成内容，排除真实 Taste payload、私人路径及日志。提交上游仍需用户另行确认，且不会扩大内容公开范围。
4. 如果确实需要“只在本机提交”，单独定义启用方式及状态，默认关闭，不自动写 main，不将其记作已发布，也不回退到公开目标。

## 后续实现验收

- 使用合成 Taste 夹具验证：公开远端、身份或授权无法确认时，在 materialize/add/commit/push 前拒绝；没有授权时零远端写入。
- 确认只有获授权的私有家仓接收 `privacy: public` 内容；源码 fork、开源上游及 outbound sync 不包含 Taste payload 或私人证据。
- 标准隔离 publisher 从新鲜私有家仓 origin/main 创建一次性工作区；源 checkout 的 dirty/ahead/behind/WIP 不作为拒绝条件，也不进入审批事务。只有未来另行批准且实际写入本地工作区的模式，才对被写入的工作区要求 clean，并处理并发文件修改、不丢失用户内容。
- 覆盖 materialize、add、commit 各阶段失败、重复调用与不可判定结果。
- 区分本地待发布、私有家仓发布成功和公开源码 PR 待审等不同状态；源码 PR 合入不代表 Taste 发布成功。
- 源码 checkout 配置与安装目录构建目标分开，不再使用本机 `tsconfig.install-build.json` 的绝对路径覆盖安装版 dist。

## 本次没有执行的动作

本 PR 只有文档，未迁入 local-only 实现，未修改安装目录、进程环境或运行配置，未触发 Taste 发布。原始本机修改仍保留，供审批后继续处理。上述拒绝场景是后续实现的验收要求，不是本 PR 已实现的运行时校验；本文件未附带真实 Taste 内容。
