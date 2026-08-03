# OpenCode 与 Claude 本地 Agent 接口核验

调查日期：2026-08-03  
目标环境：Windows 10/11  
结论适用版本：OpenCode 1.18.10；Claude Code 2.1.220

## 结论

- 本机确实存在 `opencode` 与 `claude`；`cluade` 不存在。`claude --version` 明确返回 `2.1.220 (Claude Code)`，npm 启动脚本也指向官方包 `@anthropic-ai/claude-code`，因此本票据中的 “cluade” 可确认是 Claude Code CLI 的拼写错误，而不是 Claude Desktop、Claude API 或其他产品。
- OpenCode 对本地网页应用的最佳接口是受控的本机伴随服务：伴随服务管理 `opencode serve`，通过 OpenAPI/HTTP/SSE 调用并保管 Basic Auth；也可按任务调用 `opencode run --format json`，或以 `opencode acp` 的 stdin/stdout NDJSON 接入。
- Claude Code CLI 没有供浏览器直连的本机 HTTP Agent API。网页应用必须经过本机伴随服务，由其使用 Claude Agent SDK，或把 `claude -p` 作为子进程并解析 `json`/`stream-json`。官方 Agent SDK 本身仍会为每个会话启动并监管一个 `claude` 子进程。
- 当前机器只确认安装了两个 CLI；全局 Node.js/Python 环境中未发现 `@opencode-ai/sdk`、`@anthropic-ai/claude-agent-sdk` 或 `claude_agent_sdk`。这不影响调用现有 CLI，但意味着 SDK 方案需要另行纳入依赖评审；本次按要求没有安装或升级任何工具。
- 安全默认值应是：只监听 loopback、浏览器不接触模型或 CLI 凭据、工作目录白名单、每会话独立生命周期、固定并发上限、服务端权限策略、可取消、输出脱敏。不能把 OpenCode/Claude 的完整本机权限直接暴露给网页前端。

## 本机探测证据摘要

仅执行版本、help、命令可执行性和精确包存在性检查；没有登录、没有发起模型请求、没有读取或输出任何令牌、Cookie、密钥、账号标识或配置内容。

- `Get-Command opencode`：存在，PowerShell shim 为 `C:\Users\Lenovo\AppData\Roaming\npm\opencode.ps1`。
- `opencode --version`：`1.18.10`。
- shim 指向 `node_modules/opencode-ai/bin/opencode.exe`；本机 `opencode-ai/package.json` 记录版本 `1.18.10`、许可证 `MIT`、支持 `win32` x64/arm64。
- `Get-Command claude`：存在，PowerShell shim 为 `C:\Users\Lenovo\AppData\Roaming\npm\claude.ps1`。
- `claude --version`：`2.1.220 (Claude Code)`。
- shim 指向 `node_modules/@anthropic-ai/claude-code/bin/claude.exe`；本机包名、作者与主页均对应 Anthropic 官方 Claude Code。
- `Get-Command cluade`：不存在。
- `opencode --help` 实测包含 `run`、`serve`、`attach`、`models`、`session`、`export`、`acp`、`providers`；`opencode run --help` 包含 `--format json`、`--continue`、`--session`、`--fork`、`--model`、`--attach`、`--auto`。
- `claude --help` 实测声明默认交互、`-p/--print` 非交互，并包含 `--input-format text|stream-json`、`--output-format text|json|stream-json`、`--json-schema`、`--continue`、`--resume`、`--session-id`、`--fork-session`、`--model`、`--permission-mode`、`--allowedTools`、`--disallowedTools`、`--max-budget-usd`、`--bg`。
- `opencode session list --help` 实测支持 `--format json`；`opencode export --help` 支持 JSON 导出及 `--sanitize`；`opencode acp --help` 可用。
- `claude agents --help` 实测支持 `--json` 查询后台会话；`claude auth status --help` 支持 JSON/文本状态输出。
- 在完全丢弃状态命令输出后，仅检查退出码：`claude auth status` 与 `opencode providers list` 均返回 0。由此只能确认状态接口可执行，不能据此记录具体认证方式、账号或已配置 provider。
- 全局 SDK 精确路径探测结果：Node OpenCode SDK=false，Node Claude Agent SDK=false，Python Claude Agent SDK=false。

## OpenCode 1.18.10

### 非交互调用与结构化 I/O

- `opencode run [message..]` 是官方非交互入口；输入仍是文本/文件而非 JSON 请求协议，`--format json` 输出逐行 JSON 事件流而非单个最终 JSON 对象，stdin 也由本机 PowerShell shim 转交给可执行文件。[官方 CLI](https://opencode.ai/docs/cli/)；[v1.18.10 `run.ts`](https://github.com/anomalyco/opencode/blob/v1.18.10/packages/opencode/src/cli/cmd/run.ts)
- `opencode acp` 通过 stdin/stdout 传输以 NDJSON 分帧的 ACP JSON-RPC 消息，可作为编辑器或其他 ACP 宿主与 OpenCode 之间的长连接协议；它不是浏览器 HTTP API。[官方 CLI：ACP](https://opencode.ai/docs/cli/#acp)；[v1.18.10 ACP 实现](https://github.com/anomalyco/opencode/blob/v1.18.10/packages/opencode/src/acp/agent.ts)
- `opencode serve` 提供 OpenAPI 3.1 HTTP API，`/event` 与 `/global/event` 提供 SSE；`/doc` 提供当前运行实例的契约。应以本机实例的 `/doc` 为最终类型依据，避免在线文档与安装版本漂移。[官方 Server](https://opencode.ai/docs/server/)
- 官方 JS/TS SDK 是该 OpenAPI 的类型化客户端，并支持 JSON Schema 结构化模型输出；本机未安装该 SDK。对 1.18.10 应以 `/doc` 或固定 tag 类型为准：实际请求字段为 `format`，返回位于 `info.structured`，不能照抄滚动文档中的 `outputFormat`/`structured_output` 命名。[官方 SDK](https://opencode.ai/docs/sdk/)；[v1.18.10 生成类型](https://github.com/anomalyco/opencode/blob/v1.18.10/packages/sdk/js/src/v2/gen/types.gen.ts)

### 持续会话

- CLI 支持 `--continue`、`--session <id>` 与 `--fork`；会话列表可输出 JSON，导出命令输出 JSON 并可用 `--sanitize` 脱敏。[官方 CLI：run/session/export](https://opencode.ai/docs/cli/)
- HTTP API 可创建、列出、查询、删除、fork、读取消息和状态；同步消息接口等待回复，`prompt_async` 异步返回 204，事件通过 SSE 观察。[官方 Server：Sessions/Messages](https://opencode.ai/docs/server/#sessions)

### 模型发现与选择

- `opencode models [provider]` 列出已配置 provider 可用模型，格式为 `provider/model`；`--refresh` 会从 Models.dev 刷新缓存，`--verbose` 包含成本等元数据。本次没有输出实际模型/provider 列表，避免披露本机配置状态。[官方 CLI：models](https://opencode.ai/docs/cli/#models)
- CLI `--model`、配置中的 `model` 与 HTTP prompt 的 `{ providerID, modelID }` 均可选择模型；HTTP `/provider` 和 `/config/providers` 可做程序化发现。[官方 Models](https://opencode.ai/docs/models/)；[官方 Server：Provider](https://opencode.ai/docs/server/#provider)

### 权限与无人值守策略

- 权限动作是 `allow`、`ask`、`deny`，可按工具、命令或路径细化；默认多数操作是 `allow`，`external_directory` 与 `doom_loop` 默认 `ask`，`.env` 默认拒读。[官方 Permissions](https://opencode.ai/docs/permissions/)
- `--auto` 会自动批准所有未显式拒绝的请求，本机 help 明确标为危险。无人值守场景应优先使用明确 allow/deny 策略，而不是把 `--auto` 当作安全边界。
- 独立的 `opencode run` 对未被处理的权限请求会自动拒绝，不会无限等待；若使用长期 HTTP Server 并保留 `ask`，集成方必须订阅 `permission.asked` 事件并调用会话权限响应端点。[v1.18.10 `run.ts`](https://github.com/anomalyco/opencode/blob/v1.18.10/packages/opencode/src/cli/cmd/run.ts)；[官方 Server：权限响应端点](https://opencode.ai/docs/server/#sessions)

### 超时、取消与并发

- HTTP/SDK 提供 `session.abort`；SDK 启动服务支持 `AbortSignal`，并有服务启动超时（文档默认 5000 ms）。[官方 SDK](https://opencode.ai/docs/sdk/)
- `opencode run --help` 没有整个 Agent 运行的 wall-clock timeout。调用方必须设置截止时间，并在超时时先调用会话 abort，必要时终止其拥有的子进程/服务。
- Server 文档暴露多会话状态、异步 prompt 和 SSE，但没有承诺全局最大并发数，也没有说明对同一 session 并发提交 prompt 的一致性语义。[官方 Server](https://opencode.ai/docs/server/)
- 因此本地伴随服务应对同一 session 串行化 turn，并按 CPU、内存、provider 限流设置全局并发上限；不能把“API 接受多个会话”解释成“无限并发”。

### 认证、许可与使用限制

- 模型 provider 认证由 OpenCode provider 管理，也可来自环境变量或项目 `.env`；具体计费、配额和使用条款取决于所选 provider。[官方 CLI：auth/providers](https://opencode.ai/docs/cli/#auth)；[官方 Providers](https://opencode.ai/docs/providers/)
- `opencode serve/web` 只有在设置 `OPENCODE_SERVER_PASSWORD` 时才启用 HTTP Basic Auth，用户名默认 `opencode`；未设置不能视为有应用层认证。[官方 Server：Authentication](https://opencode.ai/docs/server/#authentication)
- ACP 在 1.18.10 中不实现协议内认证握手，`authenticate()` 会直接报未实现；必须在进程外预先配置 provider 认证，不能依赖 ACP 客户端代为登录。[v1.18.10 ACP 实现](https://github.com/anomalyco/opencode/blob/v1.18.10/packages/opencode/src/acp/agent.ts)
- OpenCode 本地程序本身是 MIT License；本机包元数据与官方仓库 LICENSE 一致。模型服务、第三方插件、provider 以及可选 OpenCode Zen 不受该 MIT 许可自动覆盖；分发或自动化使用 Zen 前需另审其服务条款与数据政策。[官方 LICENSE](https://github.com/anomalyco/opencode/blob/v1.18.10/LICENSE)；[OpenCode Terms](https://opencode.ai/legal/terms-of-service)；[Zen 文档](https://opencode.ai/docs/zen/)

### 已发现版本差异

- 本机 1.18.10 的 `opencode serve --help` 显示端口默认值为 `0`，当前官方 Server 页面写默认 `4096`；1.18.10 源码实际会先尝试 4096、占用时回退随机端口。集成必须显式指定端口，或读取进程实际地址后做 health check，不能依赖 help/网页中的默认值。[v1.18.10 网络实现](https://github.com/anomalyco/opencode/blob/v1.18.10/packages/opencode/src/cli/network.ts)
- OpenCode SDK 滚动文档中的结构化字段名与 1.18.10 v2 生成类型不一致；应固定 SDK 版本并使用该版本 `/doc` 生成或校验客户端。
- 本机顶层命令名为 `providers`，并把 `auth` 作为 alias；当前官方 CLI 页面主要使用 `auth`。脚本应优先使用本机 help 中的稳定可用形式，并在升级测试中覆盖 alias。

## Claude Code 2.1.220

### 产品身份、非交互调用与结构化 I/O

- 环境证据已把 `claude` 确认为 Claude Code CLI；无法把不存在的 `cluade` 解释成其他 Claude 产品。
- `claude -p/--print` 非交互运行并以退出码表示成败；可从 stdin 读文本。`--output-format json` 返回单个结果对象，`stream-json` 返回 NDJSON 事件；`--input-format stream-json` 支持实时多轮输入。[官方 Headless](https://code.claude.com/docs/en/headless)
- `--json-schema` 要求最终结果匹配 JSON Schema，结构化值位于结果的 `structured_output` 字段；最终流事件还包含 session、成本和模型元数据。[官方 Headless：Structured output](https://code.claude.com/docs/en/headless#get-structured-output)
- 非 TypeScript/Python 宿主可直接用 CLI 子进程；官方建议其他语言用 `-p --output-format json`。TypeScript/Python 应优先评估 Claude Agent SDK。[官方 Agent SDK Overview](https://code.claude.com/docs/en/agent-sdk/overview)

### 持续会话

- CLI 支持 `--continue`、`--resume <session-id|name>`、`--session-id <uuid>` 与 `--fork-session`；`--no-session-persistence` 可使 print 模式会话不可恢复。[官方 CLI Reference](https://code.claude.com/docs/en/cli-reference)
- 恢复查找受当前项目目录及 worktree 范围约束；官方要求前后调用使用相同目录。[官方 Headless：Continue conversations](https://code.claude.com/docs/en/headless#continue-conversations)
- Agent SDK 可在同一进程保持多轮，也可按 session ID resume/fork；会话持久化的是对话而非文件系统。跨主机恢复需要同步会话存储或显式传递应用状态。[官方 Agent SDK Sessions](https://code.claude.com/docs/en/agent-sdk/sessions)

### 模型发现与选择

- `--model` 接受别名或完整模型名；本机 help 举例 `fable`、`opus`、`sonnet`。官方还记录 `/model` 交互选择器及设置优先级。[官方 Model Configuration](https://code.claude.com/docs/en/model-config)
- 本机顶层 help 没有独立的 `claude models --json` 或等价批量发现命令。可用模型受账号/provider、组织 allowlist 和发布状态影响；程序不应硬编码“所有 Anthropic 模型都可用”。
- TypeScript Agent SDK 提供 `supportedModels()` 做当前账号/provider 的程序化发现；与 CLI 不同，Python SDK 2.1.220 对齐版本没有对应的正式发现方法。[官方 TypeScript SDK：Query object](https://code.claude.com/docs/en/agent-sdk/typescript#query-object)；[Python SDK v0.2.128](https://github.com/anthropics/claude-agent-sdk-python/blob/v0.2.128/src/claude_agent_sdk/client.py)
- `stream-json` 的 `system/init` 事件会报告本次会话实际模型；这比根据 alias 猜测更可靠。[官方 Headless：Read session metadata](https://code.claude.com/docs/en/headless#read-session-metadata)

### 权限提示与无人值守策略

- 本机支持 `--allowedTools`、`--disallowedTools` 与 `--permission-mode acceptEdits|auto|bypassPermissions|manual|dontAsk|plan`。官方说明 `manual` 是 `default` 的 UI alias。[官方 CLI Reference](https://code.claude.com/docs/en/cli-reference)
- 对无人值守且工具面固定的流程，优先用 `dontAsk` 加明确 allowlist：未预批准操作直接拒绝，不等待人工。需要动态批准时，Agent SDK 提供 `canUseTool`，CLI 也有 MCP permission prompt tool 机制；必须由受信任后端实现，不能信任浏览器直接给出的“允许”。[官方 Agent SDK Permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- `bypassPermissions`/`--dangerously-skip-permissions` 不是 allowlist：未命中 deny/ask 的工具会自动运行。官方只建议在隔离 sandbox/VM 中使用。[官方 Permission Modes](https://code.claude.com/docs/en/permission-modes)

### 超时与取消

- CLI 没有通用的顶层 wall-clock timeout。调用方应由进程监管器设置截止时间；官方记录 SIGTERM 会中止当前 turn、终止 Bash 子进程树、运行 SessionEnd hooks 并以 143 退出，但没有对 Windows Job Object/CTRL_BREAK 的等价行为作出保证。[官方 Headless：Background tasks at exit](https://code.claude.com/docs/en/headless#background-tasks-at-exit)
- TypeScript Agent SDK 接受 `AbortController`；还可通过环境设置每次 API 请求超时。官方 hosting 文档明确列出“没有顶层 session timeout”，建议以 turn 数限制并由宿主监管生命周期。[官方 TypeScript SDK](https://code.claude.com/docs/en/agent-sdk/typescript)；[官方 Hosting：Known limitations](https://code.claude.com/docs/en/agent-sdk/hosting#known-limitations)
- 本机 help 有 `--max-budget-usd`，可限制 print 模式成本；当前在线文档还列出 `--max-turns`，但本机 2.1.220 的 `claude --help` 未列出该选项。本集成不应在未做无模型调用的解析器验证前依赖 `--max-turns`。

### 并发与进程模型

- 官方说明 Agent SDK 每个 session 对应一个独立 `claude` 子进程；N 个并发 session 即 N 个子进程及各自进程树/本地 transcript。[官方 Hosting：Subprocess model](https://code.claude.com/docs/en/agent-sdk/hosting#the-subprocess-model)
- 每个并发会话应有独立 `cwd`，否则会共享并竞争同一文件系统。官方给出的初始容量估算基线是每 Agent 1 GiB RAM、5 GiB 磁盘、1 CPU，实际必须压测；大规模 subagent fan-out 还可能触发 API rate limit。[官方 Hosting：Resources/Scaling](https://code.claude.com/docs/en/agent-sdk/hosting#scaling-and-concurrency)
- `claude --bg` 与 `claude agents --json` 在本机可用，但 `--bg` 不能与 `-p/--print` 组合；它们面向 Claude Code 的后台 agent 管理，不替代网页应用自己的租户隔离、队列、取消和资源配额。[官方 CLI Reference](https://code.claude.com/docs/en/cli-reference)

### 认证、许可与使用限制

- 本机只确认 `claude auth status` 命令成功；具体账号、组织、凭据类型和内容均未读取或记录。
- 官方支持 Claude 订阅 OAuth、Console API key、Bedrock、Vertex、Foundry、gateway 等；非交互环境还可使用受支持的环境凭据。Windows 凭据文件位置与优先级由 Claude Code 管理，网页应用不应读取该文件。[官方 Authentication](https://code.claude.com/docs/en/authentication)
- 最关键限制：Anthropic 明确要求构建产品或服务的第三方开发者使用 Console API key 或支持的云 provider；不允许开发者代表其用户提供 Claude.ai 登录，或把 Free/Pro/Max 凭据转用于第三方产品。即使应用只在 localhost 运行，也不应默认把用户个人订阅 OAuth 当作可嵌入产品的认证机制；边界情况需向 Anthropic 确认。[官方 Legal and Compliance](https://code.claude.com/docs/en/legal-and-compliance)
- Claude Code 的使用受账号类型对应的 Consumer Terms 或 Commercial Terms 及 Usage Policy 约束；Claude Agent SDK 用于产品/服务受 Commercial Terms 约束。[官方 Legal and Compliance](https://code.claude.com/docs/en/legal-and-compliance)；[官方 Agent SDK Overview：License and terms](https://code.claude.com/docs/en/agent-sdk/overview#license-and-terms)
- 订阅与 API 的限额、计费方式不同，且会变化；程序应处理 rate limit、billing error、model unavailable，并记录每次结果里的成本/模型元数据，而不是假定固定并发或无限额度。[官方 Claude 价格与限额](https://claude.com/pricing)；[官方 Headless：API retries](https://code.claude.com/docs/en/headless#handle-api-retries)

### 已发现版本差异或未确认项

- 在线文档带有大量最低版本标记并持续更新，不能假定全部内容都属于 2.1.220。本机 help 已确认本报告列出的核心 flags，但没有列出在线文档中的 `--max-turns` 与 `--permission-prompt-tool`；这两项需在正式实现前针对安装二进制做解析器级契约测试。
- 没有执行 `/model` 或模型请求，因此没有确认本机账号实际可见的模型集合、计费方案、组织策略或 provider；这些必须在运行时发现并作为可变能力处理。
- 官方对 SIGTERM 的行为有明确说明，但没有给出 Windows 上由父进程强制终止整棵进程树的同等保证；伴随服务应使用 Windows Job Object 或等效进程树监管，并做真实取消测试。

## Windows 10/11 特有约束

- OpenCode 可原生运行 Windows，官方同时提供并推荐 WSL 路径；若在 WSL 中用 `0.0.0.0` 暴露 Server，必须重新评估 Windows 防火墙、WSL 网络模式与认证，不能沿用仅 loopback 的信任假设。[OpenCode Windows/WSL](https://opencode.ai/docs/windows-wsl/)
- Claude Code 支持 Windows 10 1809+ 与 Windows 11，但官方 sandbox 能力仅在 WSL2 可用，原生 Windows 不能把 `bypassPermissions` 视为“已有沙箱保护”。[Claude Code Setup](https://code.claude.com/docs/en/setup)

## 本地网页应用的伴随服务边界

浏览器不能安全、可靠地直接启动本机进程，也不应持有模型/provider、Claude Code 或 OpenCode server 凭据。建议边界如下：

1. 本机网页只连接一个受信任的 companion API。companion 绑定 `127.0.0.1`，校验精确 Origin、使用随机会话凭据并防 CSRF；不启用 mDNS，不监听 `0.0.0.0`。
2. companion 对工作目录使用显式白名单和规范化后的绝对路径，拒绝路径穿越；每个 Agent session 绑定固定 cwd。浏览器不能提交任意可执行文件路径、环境变量或 shell。
3. OpenCode 适配器管理一个显式端口的 `opencode serve`，设置独立 Basic Auth，等待 `/global/health` 后才接流量。1.18.10 默认 CORS 还允许多类 localhost Origin，且 `--cors` 只能追加、不能移除内置来源，所以 CORS 不能充当认证。前端应通过 companion 代理 HTTP/SSE，不把 Basic Auth 密码注入浏览器；对同一会话串行提交，取消使用 `/session/:id/abort`。[v1.18.10 CORS 实现](https://github.com/anomalyco/opencode/blob/v1.18.10/packages/server/src/cors.ts)
4. Claude 适配器优先使用 Agent SDK；若不引入 SDK，则以参数数组启动 `claude -p --input-format stream-json --output-format stream-json`，不要拼接 shell 字符串。每个活动 session 独立子进程和 cwd，stdout 只解析协议，stderr 作为受控诊断流。
5. companion 统一输出事件：session id、状态、最终结果、结构化结果、权限请求、用量、错误；严格区分协议 stdout 与日志 stderr，并在落盘或返回前脱敏。
6. 权限策略在服务端定义。无人值守默认“未列入 allowlist 即拒绝”；绝不把 OpenCode `--auto` 或 Claude `bypassPermissions` 暴露成普通网页开关。动态批准须绑定用户、session、具体工具与具体参数，并设置短时效。
7. companion 负责 deadline、取消、进程树清理、并发队列、每用户/每 session 配额及崩溃恢复。Claude 按一 session 一子进程核算；OpenCode 对同一 session 串行，跨 session 并发也需限流。
8. 产品化 Claude 集成使用 API key/云 provider，并由 companion/secret manager 持有；不要把个人订阅 OAuth 转供网页产品。OpenCode provider 凭据同样不下发浏览器。

## 建议的 MVP 选择

- OpenCode：首选 `opencode serve` + companion 反向代理 + SSE；直接 `run --format json` 作为简化回退，ACP 仅在宿主已经实现 ACP 时采用。
- Claude：当前无已安装 SDK，因此最小可行路径是 companion 监管 `claude -p` 子进程；若进入产品化、多轮流式权限处理或并发阶段，再显式引入 Claude Agent SDK。
- 两者共同的能力协商必须来自“本机版本 + help + 运行实例契约”，而不是只读在线文档；启动时记录版本，OpenCode 拉取 `/doc`，Claude 以已验证 flag 集和首个 `system/init` 事件为准。
