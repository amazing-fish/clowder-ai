---
feature_ids: []
topics: [taste, desktop, fork-contribution]
doc_kind: note
created: 2026-09-18
updated: 2026-09-18
---

# Taste 桌面 checkout 与本地发布修改审批提案

状态：待审批；这是安装版已有行为的整理及迁移建议，不是生效政策，也不启用任何发布功能。

## 已有修改及来源

安装版 0.13.0 的主体源码最接近公共历史 `01c58feb40fab2a75016a9a8d290c87f6776d9a0`；没有安装包精确构建 SHA 的证明。下列局部修改未命中可达 Git 历史：

| 来源文件 | 现有本机行为 | 本次处理 |
| --- | --- | --- |
| `desktop/service-manager.js`（部署在 Electron app 内） | 猜测本机绝对路径、排除旧路径和运行目录、用 origin URL 子串判断 checkout；找到后默认设置 local-only=1 | 不将机器路径和自动启用策略迁入源码 |
| `packages/api/src/config/env-registry.ts` | 注册 `CAT_CAFE_TASTE_LOCAL_ONLY` | 与 locator 变量分开审批 |
| `packages/api/src/domains/taste/services/TasteRepository.ts` | 抽取 `findMainWorktreePath()` 供 publisher 直接定位 main | 本次仅记录，不激活 |
| `packages/api/src/domains/taste/services/GitTastePublisher.ts` | clean 检查后向 main 工作区 materialize/add/commit；失败尝试 reset/checkout/remove | 建议不原样采纳 |

独立的 `CAT_CAFE_TASTE_GIT_ROOT` locator 见 #22 / #23。桌面启动器已经继承启动进程环境，所以显式 locator 不需要硬编码目录发现；环境修改也不会自动影响已启动程序。

## 对用户流程的影响

现有 local-only 模式没有 clone/fetch/push，却会修改主工作区并生成提交。这个结果不能表示 fork 或上游已经收到贡献。自动把“origin 不可推送”转成“写本机 main”，会改变既有隔离发布契约，也跳过本次要求的 Issue/PR 审批链。

安装版 `taste-git-root.test.js` 只覆盖路径定位与默认远端 publisher，没有覆盖 local-only 的失败、幂等或并发场景。当前已存在的硬编码路径、自动开启条件和异常回滚不能作为通用实现直接迁入。

## 建议的后续方向，等待审批

1. checkout 只接受明确选择；无效路径明确报错，不猜其他目录，不以 URL 子串替代 Git/权限验证。
2. 贡献内容先进入隔离分支，保存来源和状态；离线时保留待审分支/文件，不能声称已发布。
3. fork 的 Issue、PR、目标分支及远端必须明确；只有完成后续审批才允许合入。上游贡献另行授权。
4. 如果确实需要“只在本机提交”，单独定义启用方式及状态，默认关闭，不自动写 main。

## 后续实现验收

- 拒绝脏目标工作区，处理并发文件修改，不丢失用户内容。
- 覆盖 materialize、add、commit 各阶段失败、重复调用与不可判定结果。
- 测试显式目标分支与远端；没有授权时零远端写入。
- 将本地准备、fork PR 待审、合入、上游发布区分为不同状态。
- 源码 checkout 配置与安装目录构建目标分开，不再使用本机 `tsconfig.install-build.json` 的绝对路径覆盖安装版 dist。

## 本次没有执行的动作

本 PR 只有文档，未迁入 local-only 实现，未修改安装目录、进程环境或运行配置，未触发 Taste 发布。原始本机修改仍保留，供审批后继续处理。
