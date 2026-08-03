# 选择 Windows 本地运行架构

Type: grilling
Mode: HITL
Status: resolved
Blocked by: 02, 03, 04

## Question

在浏览器不能直接安全调用本地 CLI 的前提下，MVP 的前端、权威游戏引擎、本地 Agent 适配器和持久化应如何分层与通信，才能以最少组件可靠运行，并为未来局域网版本保留清晰边界？

## Answer

采用 npm workspaces 管理的全 TypeScript 架构。用户只启动一个 Node.js 本地协调服务；它托管编译后的 React 网页、运行权威游戏引擎、持久化对局并监管必要的 OpenCode/Claude 子进程，然后自动打开系统默认浏览器。这里的“单进程启动”指一个用户可见的启动入口，不表示禁止受监管的 Agent 子进程。

### 仓库边界

```text
apps/
  web/       React + Vite 浏览器界面
  server/    Node.js + Fastify 本地服务
packages/
  domain/    纯游戏状态机
  protocol/  命令、事件、SeatView/SeatDecision 与 JSON Schema
```

- `packages/domain` 不依赖浏览器、Node.js、数据库或模型 SDK；输入领域命令，返回新状态与事件。
- `packages/protocol` 是前端、服务端和 Agent 适配器共享的唯一传输契约，负责运行时校验并生成结构化输出所需的 JSON Schema。
- `apps/server` 是组合根：持有权威 `MatchState`，调用领域核心，按座位生成投影，管理持久化、WebSocket、Agent 适配器和进程生命周期。
- `apps/web` 只持有服务端发送的座位投影。它可以播放预测性动画，但不能自行提交未经服务端确认的规则结果。

不引入 Python 服务、LangGraph、Electron/Tauri、容器、Redis或独立数据库。

### 浏览器通信

- 服务端在随机可用端口绑定 `127.0.0.1`，托管生产构建后的网页、REST API 与 WebSocket；不监听 `0.0.0.0`，也不启用 mDNS。
- REST 用于启动状态、CLI/模型能力发现、开局配置、对局列表与回放查询。
- WebSocket 用于提交带状态版本的实时对局命令，以及按序推送领域事件和最新座位投影。
- WebSocket 断开重连时，浏览器携带最后确认的事件序号；服务端补发缺失事件，无法补发时发送完整投影。
- 网页、REST 和 WebSocket 保持同源。服务端校验精确 `Origin`，使用启动期随机会话凭据、`HttpOnly`/`SameSite=Strict` Cookie 和必要的 CSRF 防护，避免恶意网页调用 loopback 接口。

### 权威性与持久化

- 权威游戏引擎只在 `apps/server` 运行；浏览器和 Agent 都只是命令来源。
- 使用单个本地 SQLite 数据库保存非敏感设置、对局快照和追加事件。
- 每次成功领域命令在一个事务中追加事件并更新快照；事件带单调序号，支持崩溃恢复、重连补发和确定性回放。
- SQLite 驱动在实施时针对锁定的 Node.js LTS 选择；架构不把具体驱动 API 泄漏到领域核心。
- 模型/provider 凭据、OpenCode Basic Auth、原始 Agent 提示与响应、私有 CLI transcript 不写入 SQLite。

### Agent 运行边界

- `apps/server` 内部定义统一 `AgentSeatAdapter`，OpenCode 与 Claude Code 各有一个实现。
- OpenCode 适配器监管绑定 loopback、显式随机端口且设置独立 Basic Auth 的 `opencode serve`；一个服务实例可承载多个严格分离的座位会话。
- Claude 适配器以参数数组启动并监管 `claude -p` JSON/stream-json 子进程；不通过 Shell 拼接命令。
- 适配器负责版本/能力探测、结构化协议转换、会话隔离、权限拒绝、截止时间、取消和进程树清理；具体失败策略由后续票据决定。
- 浏览器不能提供可执行路径、命令行参数、工作目录、环境变量或权限模式，也不能获得任何 CLI/provider 凭据。

### 启动与分发

- MVP 从源码运行：安装依赖后，通过一条 npm 命令构建或复用网页资源、启动本地服务并打开浏览器。
- 启动器应防止同一数据目录重复启动两个协调服务，并在退出时关闭 WebSocket、提交数据库事务、终止其拥有的 Agent 子进程。
- MVP 不交付便携 EXE、Windows 安装程序、系统服务、自动更新或卸载器。

### 局域网演进边界

领域核心、协议、座位投影和持久化不依赖 loopback 地址或本地玩家身份。未来局域网版本仍由服务端持有权威状态，并可复用 REST/WebSocket 边界；但监听外部网卡、房间发现、身份认证、传输安全和断线席位恢复必须作为独立设计，不能通过把当前服务改绑 `0.0.0.0` 草率实现。

## Comments
