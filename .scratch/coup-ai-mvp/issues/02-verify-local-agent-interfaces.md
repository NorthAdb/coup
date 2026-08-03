# 验证 OpenCode 与 Claude 的本地 Agent 接口

Type: research
Mode: AFK
Status: resolved
Blocked by: none

## Question

在目标 Windows 10/11 环境中，本机已安装的 OpenCode 与 Claude 分别提供哪些可靠的程序化调用方式？需要核实非交互调用、结构化输入输出、会话管理、模型发现与选择、权限提示、超时/取消、并发限制及许可约束，并指出实际安装版本与官方文档之间的差异。

## Answer

本机确认安装 OpenCode 1.18.10 与 Claude Code 2.1.220；`cluade` 不存在，Claude 身份由版本输出和官方 npm 包路径确认。OpenCode 可通过 `run --format json` 事件流、ACP 的 stdio JSON-RPC/NDJSON 或 `serve` 的 OpenAPI/HTTP/SSE 集成；Claude Code 可通过 `claude -p` 的 JSON/stream-json 子进程接口集成，产品化多轮场景宜由本地伴随服务使用 Agent SDK。浏览器不应直接持有凭据或控制进程；伴随服务必须负责 loopback 绑定、权限策略、工作目录隔离、取消、进程树和并发限制。Claude 产品集成不能默认复用用户个人订阅 OAuth，应使用 API key/受支持云 provider 并遵守 Anthropic 条款。

完整本机证据、逐项能力核验、版本差异与官方来源见 [研究报告](../research/local-agent-interfaces.md)。

## Comments
