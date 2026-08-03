# 《政变》AI 单机网页 MVP 决策地图

## Destination

形成一份可直接交给开发执行的《政变》AI-first 网页 MVP 产品与技术规格，明确规则、运行架构、Agent 协议、核心交互原型和验收标准。

## Notes

- 本地图只做规划与决策，不实施 MVP。
- MVP 仅保证 Windows 10/11 本机运行。
- 对局采用基础版标准规则，共 2–6 个座位：固定 1 名本地玩家，其余 1–5 个座位为 Agent。
- 每个 Agent 座位可独立选择本机安装的 OpenCode 或 Claude Code，并在运行时发现可用模型后按座位选择。
- MVP 为本机自用：复用本机 CLI 已有登录状态，应用内不配置 API key；不适合按当前形态对外分发。
- 本机已确认 `opencode` 1.18.10 与 `claude` 2.1.220（Claude Code）；`cluade` 只是拼写错误。
- 浏览器不得直接控制 CLI 或持有凭据；OpenCode/Claude 均需经本机伴随服务接入。
- MVP 使用占位卡面；核心对局流程应达到流畅、可展示的动画与交互完成度。
- 长期方向包含局域网多人，但本轮只记录避免封死该方向所必需的架构约束。
- 研究优先使用官方规则、官方文档和一手源码；涉及领域语言时同步维护 `CONTEXT.md`。

## Decisions so far

- [核定基础版规则与边界案例](issues/01-verify-base-game-rules.md) — 基础版五角色各 3 张、官方支持 2–6 人；2 人常规局只改先手起始 1 币；响应顺序为质疑行动→阻挡→质疑阻挡→结算；可选 2 人选牌变体不进 MVP。详见 [研究报告](research/base-game-rules.md)。
- [验证 OpenCode 与 Claude 的本地 Agent 接口](issues/02-verify-local-agent-interfaces.md) — OpenCode 首选伴随服务管理 `serve`+OpenAPI/SSE；Claude Code 由伴随服务监管 `claude -p` JSON/stream-json，产品化再评估 Agent SDK；浏览器不得直连。详见 [研究报告](research/local-agent-interfaces.md)。
- [定义对局领域模型与状态机](issues/03-define-game-domain-and-state-machine.md) — 采用权威快照、版本化命令和追加事件的纯状态转换；响应按顺时针逐席处理，失败阻挡不重开窗口，随机过程可回放；统一术语见 [`CONTEXT.md`](../../CONTEXT.md)。
- [定义 Agent 座位协议与信息边界](issues/04-define-agent-seat-protocol.md) — 采用统一、版本化的 `SeatView`/`SeatDecision` JSON；每座位使用完整权限投影和独立可重建会话，禁用全部外部工具，原始私有会话不跨对局留存。
- [选择 Windows 本地运行架构](issues/05-choose-local-runtime-architecture.md) — 采用 React/Vite + Node/Fastify 的 npm workspaces；单一启动入口托管同源网页与 REST/WebSocket，服务端运行权威引擎、SQLite 和 Agent 进程监管；MVP 从源码启动且只绑定 loopback。
- [定义 Agent 失败处理与回合节奏](issues/06-define-agent-failure-and-pacing.md) — Agent 决策首次限时 30 秒、仅可恢复错误再试 15 秒；仍失败则技术中止整局且无胜者，可从故障前快照创建恢复运行；默认平衡节奏并提供快速模式。
- [原型化核心对局体验](issues/07-prototype-core-match-experience.md) — 选定策划桌布局（左座位、中舞台、右对局记录），底部合法行动栏与中央响应条；顶栏可查看规则摘要；动效克制，重点覆盖质疑亮牌与补牌。原型见 [prototypes/core-match](prototypes/core-match/)。
- [定义对局创建与 Agent 配置体验](issues/08-define-match-setup-experience.md) — 先选 2–6 人再逐座位配置 OpenCode/Claude 与模型；进入页面即探测就绪状态，全部就绪才可开局；记住上次配置；复用本机 CLI 登录态，不内置 API key。
- [确定局域网演进边界](issues/09-preserve-lan-evolution-boundary.md) — 未来为创建房间/房间号加入的主机权威模型；MVP 保持领域与协议不绑定 loopback，座位控制器可扩展到远程人类；本轮不实现发现、房间与断线恢复。
- [汇总 MVP 规格与验收边界](issues/10-define-mvp-acceptance-spec.md) — 交付索引型 [`spec.md`](spec.md)：验收清单 + 决策链接；Chrome/Edge 桌面浏览器适配；事件列表回放与快照恢复；不做牌力评测。

## Not yet specified

- 局域网房间号格式、大厅视觉、最近房间、传输安全与断线重连的具体规格；待联网专题单独开图。
- Agent 人格、难度与牌力评测若需要，待新努力单独制图。

## Out of scope

- 本轮直接编写或交付可玩的游戏。
- MVP 中实现局域网联机、互联网联机或匹配服务。
- 扩展角色、自定义角色、热座多人、纯 Agent 观战及一局多名本地玩家。
- 直接复制或随产品分发原版卡图、版式及其他受保护素材；MVP 仅使用占位素材。
- 首版支持 macOS、Linux 或移动端。
- Agent 人格、难度档、策略配置及牌力/胜率评测；见已关闭的 [定义 Agent 策略配置与可玩质量](issues/11-define-agent-strategy-and-quality.md)。
