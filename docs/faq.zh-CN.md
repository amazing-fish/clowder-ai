# 常见问题

## 什么是 Clowder AI？

Clowder AI 是一个**多 Agent 协作平台**，为 AI Agent 提供持久身份、共享记忆、跨模型评审以及 Agent 间（A2A）通信能力。

它并不是模型提供方。可以把它理解为位于你的 Agent CLI *之上*的一层 —— Claude Code、Codex CLI、Gemini CLI、opencode 等 —— 它把一组各自独立的 Agent 变成一支协同工作的团队。

每个 Agent 都拥有自己的身份（一个猫咪角色）、长期记忆，以及交接工作、请求评审和跨模型家族协作的能力。

## 我需要 Redis 吗？

**不需要。** Redis 是可选的。

使用 `--memory` 标志即可完全跳过 Redis：

```bash
pnpm start --memory
```

在此模式下，所有数据都存储在内存中，进程停止后即会丢失。这非常适合试用或本地开发。

在生产环境中，推荐使用 Redis，以便记忆、线程和任务状态在重启后依然保留。

## 如何跳过构建步骤？

如果你已经构建过一次，且没有改动任何源代码，可以使用：

```bash
pnpm start --quick
```

这会跳过完整构建，让你更快地运行起来。适合日常使用中的快速重启。

## 在哪里添加 API 密钥？

你**无需**为 API 密钥编辑 `.env`。

启动 Clowder AI 后，打开 Hub 并前往：

> **System Settings --> Account Configuration**
>
> **系统设置 --> 账户配置**

在此添加你的模型提供方密钥。UI 会安全地存储它们，并让所有 Agent 都能使用。

## 它使用哪些端口？

| 服务  | 默认端口 | .env 变量          |
|----------|-------------|---------------------|
| 前端 | 3003        | `FRONTEND_PORT`     |
| API      | 3004        | `API_SERVER_PORT`   |
| Redis    | 6399        | `REDIS_PORT`        |
| MCP      | 3011        | `MCP_SERVER_PORT`   |

所有端口都可以在你的 `.env` 文件中配置。详见[环境变量](configuration/environment.md)参考文档。

## 可以在局域网 / 手机上运行它吗？

可以。在你的 `.env` 中设置：

```env
# Bind to all interfaces so other devices can reach the server
# 绑定到所有网络接口，让局域网内其他设备可以访问
API_SERVER_HOST=0.0.0.0

# Allow private-network requests (phones/tablets on the same Wi-Fi)
# 允许局域网内的私有网络请求（同一 Wi-Fi 下的手机/平板）
CORS_ALLOW_PRIVATE_NETWORK=true
```

然后在你的手机或平板上打开 `http://<your-machine-ip>:3003`。

## 支持哪些 Agent CLI？

Clowder AI 可与任何支持 MCP（Model Context Protocol）的 Agent CLI 配合使用：

- **Claude Code**（Anthropic）
- **Codex CLI**（OpenAI）
- **Gemini CLI / Antigravity CLI**（Google）
- **opencode**（多模型）

请参阅项目 README 获取每个 CLI 的设置说明。

### 如何让 Codex CLI 使用 GPT-6 Sol？

先运行 `codex --version`，使用 **0.156.1 或更新版本**；[Codex 0.156.1 发布记录](https://github.com/openai/codex/releases/tag/rust-v0.156.1)首次明确加入 GPT-6 Sol 的模型目录。账号也须具备该模型的使用权限。在 Hub 的「系统配置 → 账户配置」中为 OpenAI OAuth 账户添加 `gpt-6-sol`，再将所需成员的模型设为 `gpt-6-sol`。现有成员的默认模型不会自动改变。

可选推理档位为 `none`、`low`、`medium`、`high`、`xhigh`、`max`，不支持 `ultra`。[模型规格](https://developers.openai.com/api/docs/models/gpt-6-sol)给出的上下文窗口为 1,050,000 tokens。Clowder AI 会显示可用的 token usage；在无法从 CLI 用量中可靠区分实际服务档位和长上下文计费档时，费用保持未知，不套用旧模型的单价。配置完成后，用新会话和续接会话各发一条消息，确认模型标识与回复均正确。

## Bootcamp 如何运作？

Bootcamp 是一段引导式的上手体验，你的 AI 团队会带你走完一个完整的功能生命周期 —— 从启动、评审到合并。

要开始，请启动 Clowder AI 并打开 **Hub**。你会在主屏幕上看到 Bootcamp 选项。整个过程是交互式的：猫咪们会一步步引导你。

## 这是开源的吗？

是的。Clowder AI 以 **MIT License** 发布。欢迎贡献。
