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
- [完整角色行动与规则边界（Stub）](issues/15-full-role-actions-stub.md) — 征税/刺杀/偷窃/交换、行动质疑窗、刺杀费用退回与阻挡不退、失败阻挡不重开、交换保密选牌、淘汰与获胜；领域确定性测试 + Stub 可打到终局。
- [开局配置页](issues/16-match-setup-page.md) — 2–6 人、座位 1 固定人类、Agent 自动显示名、localStorage 记住人数/CLI/模型占位、Stub 开局；本机自用边界文案；真探测归 19。
- [OpenCode 真 Agent 座位](issues/17-opencode-agent-seat.md) — 统一 `AgentSeatAdapter`；`opencode run` + 座位 cwd `permission:* deny`；SeatView→校验→领域命令；浏览器无凭据。
- [Claude Code 真 Agent 座位](issues/18-claude-agent-seat.md) — 对等协议路径；`claude -p` JSON schema + 全工具禁用；与 OpenCode 可混座。
- [开局能力探测与就绪门禁](issues/19-capability-probe-gate.md) — 进页探测 CLI/认证/模型；座位就绪状态与「重新检测」；未就绪不可开局；开始时服务端复检；响应脱敏。
- [持久化、事件回放与快照恢复](issues/20-persistence-replay-resume.md) — SQLite 事务追加事件+快照；事件列表回放；重启恢复未结束对局；技术中止无胜者并可从快照开恢复运行；不落凭据/transcript。
- [Agent 超时重试与中止节奏](issues/21-agent-timeout-abort.md) — 30s+可恢复再试 15s；新 requestId；迟到丢弃；不可恢复立即 technical_abort；UI 仅有限相位；复用票 20 快照恢复。
- [策划桌 UI 打磨](issues/22-desk-ui-polish.md) — 左座位/中舞台+响应条/右记录/底行动栏/顶栏规则；克制亮牌与补牌；平衡/快速节奏与 reduced-motion；深色权谋占位卡。
- [座位卡公开模型标签](issues/23-seat-model-labels.md) — `PublicSeatView` 公开 `cli`/`modelId`；座位卡 `seatModelLabel` 可读展示（Stub 占位不空白）。
- [座位呼出](issues/24-seat-callouts.md) — 公开决策旁呼出约 4s、同座替换；减动效仍可读；不改领域事件。
- [决策说明旁路与 hover](issues/25-decision-rationale-hover.md) — 可选旁路说明本局内存、模板兜底、来源标签；不进权威历史。
- [结果节拍表现层回放](issues/26-result-beat-replay.md) — 权威一次推进后按轻重两档在中央舞台回放「刚才发生」；不倒带状态；见 ADR-0002。
- 座位可读性增强（grilling）— `PublicSeatView` 公开 CLI/模型；决策说明为本局旁路（最近一条、模板兜底、标明来源）；座位呼出播公开决策约 4 秒且替换；改写 US-42 并新增 US-56/57。术语见 [`CONTEXT.md`](../../CONTEXT.md)；取舍见 [`ADR-0001`](../../docs/adr/0001-decision-rationale-sidecar.md)。实现票：[23 座位卡公开模型标签](issues/23-seat-model-labels.md)、[24 座位呼出](issues/24-seat-callouts.md)、[25 决策说明旁路与 hover](issues/25-decision-rationale-hover.md)（均可立即开始）。
- 确认条、大使保留选牌与座位色（grilling）— 本地人类声明行动与大使选牌经确认条提交；大使 UI 按「保留」选牌、领域仍 `returnCardIds`；座位色固定辨识名与座位卡。新增 US-59/60/61；术语见 [`CONTEXT.md`](../../CONTEXT.md)；取舍见 [`ADR-0003`](../../docs/adr/0003-confirmation-bar-scope.md)。实现票：[27 确认条与大使保留选牌](issues/27-confirmation-bar-exchange-keep.md)、[28 座位色辨识](issues/28-seat-colors.md)（均可立即开始）。

## Not yet specified

- 局域网联机具体规格已迁出本图，见 [《政变》局域网联机规格决策地图](../coup-lan-multiplayer/map.md)。
- Agent 人格、难度与牌力评测若需要，待新努力单独制图。

## Out of scope

- 本轮直接编写或交付可玩的游戏。
- MVP 中实现局域网联机、互联网联机或匹配服务。
- 扩展角色、自定义角色、热座多人、纯 Agent 观战及一局多名本地玩家。
- 直接复制或随产品分发原版卡图、版式及其他受保护素材；MVP 仅使用占位素材。
- 首版支持 macOS、Linux 或移动端。
- Agent 人格、难度档、策略配置及牌力/胜率评测；见已关闭的 [定义 Agent 策略配置与可玩质量](issues/11-define-agent-strategy-and-quality.md)。
