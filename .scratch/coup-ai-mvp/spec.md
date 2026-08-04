Status: ready-for-agent

# 《政变》AI-first 本机网页 MVP

## Problem Statement

我想在自己的 Windows 电脑上，用网页玩基础版桌游《政变》，并让本机已安装的 OpenCode、Claude Code 作为不同座位的对手。现有方案要么是实体桌游，要么是无法接入本地 CLI Agent、也缺少清晰信息隔离的通用聊天工具。我需要一个本机可启动的网页对局：规则正确、隐藏信息不泄露、Agent 只能做合法选择，并且界面有足够质感可展示，同时为以后局域网「创建房间 / 加入房间」留出边界，而不在第一版就做联网。

## Solution

提供一个从源码启动的本机网页应用：一条命令拉起 Node 本地服务，自动打开浏览器。用户配置 2–6 个座位（自己固定占一座，其余为 Agent），为每个 Agent 选择 OpenCode 或 Claude Code 及可用模型后开局。服务端运行权威对局引擎与 Agent 编排；浏览器只显示当前座位投影并提交决策。对局采用策划桌布局与占位卡面，质疑时有克制的亮牌与补牌动效。Agent 失败会有界重试，仍失败则技术中止并可从快照恢复。第一版只保证 Windows + Chrome/Edge，复用本机 CLI 登录态，不内置 API key，不评测牌力。

## User Stories

1. As a 本地玩家, I want 用一条命令启动游戏并自动打开浏览器, so that 我不必手动拼服务地址。
2. As a 本地玩家, I want 服务只监听本机 loopback, so that 局域网其他人默认进不来。
3. As a 本地玩家, I want 在开局页选择 2–6 人, so that 人数与桌游基础版一致。
4. As a 本地玩家, I want 自己的座位固定且不可改成 Agent, so that 每局始终有一个人类参与者。
5. As a 本地玩家, I want 为每个 AI 座位分别选择 OpenCode 或 Claude Code, so that 不同模型可以同桌对弈。
6. As a 本地玩家, I want 从运行时发现的模型列表里选模型, so that 我只看到本机真正可用的选项。
7. As a 本地玩家, I want 进入开局页时自动探测 CLI、认证与模型就绪状态, so that 我开局前就知道哪里坏了。
8. As a 本地玩家, I want 未就绪时无法点开始并看到可操作提示, so that 我不会开到一半才发现 Agent 不能用。
9. As a 本地玩家, I want 可以手动重新检测, so that 我在终端登录 CLI 后不必重启整个应用。
10. As a 本地玩家, I want 系统记住上次人数与座位配置, so that 下次开局更快。
11. As a 本地玩家, I want 页面标明本机自用、复用 CLI 登录态, so that 我理解当前不做产品化 API key 配置。
12. As a 本地玩家, I want Agent 座位有自动生成的显示名, so that 桌上容易区分对手。
13. As a 本地玩家, I want 自己固定先手、其余按座位列表顺时针, so that 座次规则简单可预期。
14. As a 本地玩家, I want 开局后进入策划桌界面, so that 我能同时看到对手、舞台、手牌与记录。
15. As a 本地玩家, I want 左侧看到各 Agent 的钱币、公开牌、模型与状态, so that 公开信息一眼可读。
16. As a 本地玩家, I want 中央舞台显示当前行动与角色声明, so that 焦点始终清楚。
17. As a 本地玩家, I want 轮到我响应时出现紧凑响应条, so that 我能质疑、阻挡或放弃且不遮住桌面。
18. As a 本地玩家, I want 底部只启用当前合法行动, so that 我不会点到非法操作。
19. As a 本地玩家, I want 需要目标的行动先选行动再点高亮座位, so that 目标与行动一起提交。
20. As a 本地玩家, I want 右侧看到对局记录, so that 我能回顾本局发生了什么。
21. As a 本地玩家, I want 顶栏打开规则介绍, so that 我不必离开对局查规则。
22. As a 本地玩家, I want 看到自己的两张面朝下角色牌, so that 我能决定是否诈唬。
23. As a 本地玩家, I want 看不到对手的隐藏牌与宫廷牌库顺序, so that 信息边界与桌游一致。
24. As a 本地玩家, I want 收入、外援、政变与角色行动都按基础版规则结算, so that 玩法可信。
25. As a 本地玩家, I want 10 枚及以上钱币时只能政变, so that 强制政变规则被执行。
26. As a 本地玩家, I want 2 人局先手只有 1 枚起始钱币, so that 双人局平衡与官方一致。
27. As a 本地玩家, I want 质疑先于阻挡、阻挡后再质疑阻挡, so that 复杂时序不会乱。
28. As a 本地玩家, I want 响应按顺时针逐席进行且第一个有效响应生效, so that 多人抢响应有确定结果。
29. As a 本地玩家, I want 虚假阻挡被揭穿后不再重开阻挡窗口, so that 流程不会无限拖延。
30. As a 本地玩家, I want 被质疑时可以选择证明或认输, so that 我保留桌游中的决策权。
31. As a 本地玩家, I want 证明成功时看到亮牌、洗回与补牌动效, so that 关键反馈有质感但不花哨。
32. As a 本地玩家, I want 失去影响力时自己选择揭示哪张牌, so that 我能保留更有价值的角色。
33. As a 本地玩家, I want 两张牌都失去后被淘汰且钱币回库, so that 终局条件正确。
34. As a 本地玩家, I want 只剩一名未淘汰参与者时立即获胜, so that 对局及时结束。
35. As a 本地玩家, I want 刺杀费用在声明被成功质疑时退回、被阻挡时不退, so that 费用边界正确。
36. As a 本地玩家, I want 大使交换时秘密选牌且对方不知道换了几张, so that 私密信息被保护。
37. As an Agent 座位控制器, I want 只收到该座位的 SeatView, so that 我看不到别人的手牌。
38. As an Agent 座位控制器, I want legalDecisions 枚举全部合法选择, so that 我不必发明非法行动。
39. As an Agent 座位控制器, I want 只返回结构化 SeatDecision, so that 引擎可以严格校验。
40. As an Agent 座位控制器, I want 独立会话且禁用外部工具, so that 我无法通过文件或 Shell 作弊。
41. As an Agent 座位控制器, I want 完整投影历史以便会话重建, so that 丢会话后仍能继续决策。
42. As a 本地玩家, I want Agent 思考时只看到阶段状态提示、决策落地后可 hover 查看该座位最近一次决策说明（标明 Agent 原文或模板兜底）, so that 我能理解其选择动机却不接触原始思维链或 transcript。
43. As a 本地玩家, I want Agent 超时或非法输出时自动有界重试, so that 偶发错误不立刻毁局。
44. As a 本地玩家, I want 两次都失败时整局技术中止且无胜者, so that 不会伪造规则内淘汰。
45. As a 本地玩家, I want 从故障前快照继续一局新的恢复运行, so that 修完配置还能接着玩。
46. As a 本地玩家, I want 切换平衡/快速节奏, so that 我可以加快观感。
47. As a 本地玩家, I want 系统尊重减少动态效果, so that 动效不会造成不适。
48. As a 本地玩家, I want 浏览已结束或中止对局的事件列表, so that 我能简单回放发生过什么。
49. As a 本地玩家, I want 对局状态与事件写入本地 SQLite, so that 崩溃后还能恢复关键进度。
50. As a 本地玩家, I want 在 Chrome 或 Edge 桌面窗口缩放时布局仍可用, so that 作为网页游戏体验稳定。
51. As a 未来局域网主机, I want 领域与协议不绑定唯一本地玩家或 loopback, so that 以后能加远程人类座位。
52. As a 未来局域网玩家, I want 以后用创建房间/房间号加入, so that 联机方式符合常见桌游网页习惯。
53. As a 开发者, I want 领域核心不依赖 UI 与 CLI, so that 规则可以用确定性测试锁住。
54. As a 开发者, I want 共享协议包承载命令、事件与 SeatView schema, so that 前后端与适配器契约一致。
55. As a 安全敏感用户, I want 浏览器永不持有 CLI 或 provider 凭据, so that 恶意网页更难滥用本机 Agent。
56. As a 本地玩家, I want 左侧座位卡显示各 Agent 的 CLI 与模型可读标签, so that 我能分辨桌上对手实际在跑什么。
57. As a 本地玩家, I want 任一座位作出公开决策后在座位旁出现约 4 秒的座位呼出且后来者替换前者, so that 我不必紧盯右侧对局记录也能跟上刚刚发生的选择。
58. As a 本地玩家, I want 权威一次推进后的新增公开事件按结果节拍在中央舞台回放（重拍停住、轻拍短闪）, so that 我不用紧盯右侧对局记录也能看清刚发生的连锁结果。
59. As a 本地玩家, I want 声明行动（含目标）时先经确认条 Cancel/Confirm 再提交, so that 我不会一点即交、节奏也可读。
60. As a 本地玩家, I want 大使交换时从候选牌中选择要保留的影响力并经确认条确认, so that 换牌是我自己选的而不是随机替换。
61. As a 本地玩家, I want 每个座位有固定座位色且名字在座位卡与公开文案中同色显示, so that 我不必只靠读名分辨谁是谁。

## Implementation Decisions

- 采用 npm workspaces 的全 TypeScript 结构：网页应用、本地服务、纯领域包、共享协议包。
- 用户可见启动入口为一个本地服务进程：托管构建后的网页、权威引擎、SQLite、Agent 进程监管，并打开系统浏览器。
- 服务绑定本机 loopback 随机端口；不监听外部网卡；不做 mDNS。
- REST 负责能力发现、开局配置、对局列表与事件回放查询；WebSocket 负责带状态版本的实时命令与有序事件/投影推送。
- 网页与 API 同源；精确 Origin 校验、启动期随机会话凭据、HttpOnly 与 SameSite=Strict Cookie，并做必要 CSRF 防护。
- 权威 `MatchState` 只在服务端；浏览器仅保存当前座位投影，可做预测性动画，但不能裁定规则结果。
- 领域核心是确定性命令处理器：校验版本与阶段后产生新快照与追加事件；洗牌/抽牌由隐藏种子驱动，事件记录实际结果。
- 外部领域命令限于：声明行动、质疑/放弃、阻挡/放弃、证明/认输、选择揭示牌、选择交换归还牌。阶段推进与终局检查由核心自动完成。
- 主阶段顺序：等待行动 → 质疑行动 →（证明/揭示）→ 阻挡 → 质疑阻挡 →（证明/揭示）→ 结算 → 下一回合；大使交换在结算中进入选牌。
- 响应窗口从声明者下一家起顺时针逐席；第一个有效响应生效；失败阻挡不重开窗口。
- 刺杀费用预留与退回规则、国库无硬上限、2 人先手 1 币等边界按已决议执行。
- 座位控制器抽象为本地人类与 Agent，预留远程人类；Agent 之间不直连，只经引擎编排。
- 统一版本化 `SeatView` / `SeatDecision` JSON；OpenCode 与 Claude 共用游戏层协议，适配器只处理 CLI 差异。
- `PublicSeatView` 公开携带座位 CLI 与模型标识（人类座位无模型）；座位卡展示可读标签，不把 raw 路径当主文案。
- 决策说明为适配器旁路字段：随已校验座位决策挂到该座位本局内存，仅最近一条可供 hover；缺省时用结构化决策模板文案并标明来源；不进领域事件、SQLite 或回放；禁止展示原始思维链 / transcript。见 ADR-0001。
- 座位呼出由表现层根据已生效公开决策生成：所有座位均可出现，约 4 秒，新呼出替换旧呼出；不替代右侧权威对局记录。
- 结果节拍：权威一次推进后，表现层按新增公开事件轻重两档在中央舞台回放「刚才发生」；不倒带权威状态；见 ADR-0002。
- 确认条：仅本地人类；覆盖声明行动（含目标）与大使选牌；草稿完整后 CONFIRM 才提交座位决策，CANCEL 只清草稿；与响应条共用中央底部槽位且互斥；响应/揭示/证明仍一键提交；不拉长结果节拍。见 ADR-0003。
- 大使选牌 UI 以「保留」表达，确认条摘要保留的角色；领域命令仍提交 `returnCardIds`，交换保密与协议形状不变。
- 座位色：按座序固定调色板；座位卡与舞台/确认条/记录/呼出中的显示名同色；≠ 角色牌颜色；不进领域事件。
- OpenCode：伴随服务管理 `serve` 并代理；Claude：伴随服务监管 `claude -p` 的 JSON/stream-json 子进程。全部工具禁用。
- Agent 决策：首次 30 秒，仅可恢复错误再试 15 秒；不可恢复错误立即技术中止；中止无胜者，可从故障前快照开恢复运行。
- 原始 Agent 会话对局结束后删除或失效；权威投影事件可留作回放。
- SQLite 在同一事务中追加事件并更新快照；不存凭据、原始模型 transcript 或决策说明。
- 开局页：选人数 → 配各 AI 座位 → 自动探测就绪 → 开始；记住上次非敏感配置。
- 对局 UI：策划桌（左座位、中舞台、右记录、底行动栏、中央响应条/确认条槽位、规则介绍）；深色权谋风占位卡；克制亮牌/补牌动效；平衡/快速节奏；座位模型标签、决策说明 hover、座位呼出、结果节拍回放、确认条、座位色。
- 回放验收为事件列表浏览；不做时间轴 scrub 动画回放。
- 本机自用：复用已安装 CLI 登录态，应用内不配置 API key；对外分发需另案。
- 不引入 Python、LangGraph、Electron/Tauri、容器或独立数据库服务器。
- 局域网房间大厅本轮不实现，但协议与领域不得写死本机专用假设。

来自座位协议原型决策的形状（非可运行 demo）：

```json
{
  "protocolVersion": 1,
  "requestId": "req-...",
  "matchId": "match-...",
  "stateVersion": 42,
  "seatId": "seat-3",
  "decisionKind": "challenge",
  "publicState": {},
  "privateState": {},
  "projectedHistory": [],
  "legalDecisions": []
}
```

```json
{
  "protocolVersion": 1,
  "requestId": "req-...",
  "stateVersion": 42,
  "decision": { "type": "pass_challenge" }
}
```

## Testing Decisions

- 好测试只断言外部行为：给定可见输入，观察状态、事件、拒绝原因或投影内容；不断言私有函数结构或框架细节。
- **主 seam（唯一优先自动化切面）**：对局领域核心。输入 `MatchState` + 版本化领域命令，输出新状态与事件；并覆盖为指定座位生成的 `SeatView` / `legalDecisions`。规则、时序、信息隐藏与不变量主要在此锁定。
- 领域测试应覆盖研究报告中的边界案例：强制政变、刺杀费用退回与否、双影响力连续损失、顺时针响应、失败阻挡不重开、大使换牌保密、2 人起始钱币等。
- 使用固定种子做确定性回放断言：同一命令序列产生同一事件与终局。
- Agent CLI 适配器、REST/WebSocket、React 页面**会真实实现**，但不作为锁规则的主测面；可用假适配器做少量编排冒烟，页面以手工验收为主。
- 仓库尚无既有测试先验；新建测试应贴近领域命令/事件语义，并使用 `CONTEXT.md` 中的术语。
- 发布验收以规格外的勾选清单为准：启动、开局探测、完整对局、失败恢复、事件列表回放、Chrome/Edge 桌面适配、无局域网与无原版卡图。

### 验收清单（发布时勾选）

- 一条命令启动，仅 loopback，Chrome/Edge 桌面可用
- 2–6 人开局配置、逐座位 CLI/模型、进页探测、未就绪不可开局
- 基础版规则与权威服务端状态机正确
- SeatView/SeatDecision、禁工具、有界重试与技术中止恢复
- 策划桌 UI、规则介绍、克制动效、占位卡面
- SQLite 快照+事件、事件列表回放
- 无牌力评测、无局域网实现、无原版美术分发

## Out of Scope

- 本规格交付的是可实施说明与验收标准；写作规格本身不等于已经实现可玩游戏。
- 局域网/互联网联机、房间号大厅、发现、传输安全、断线重连占座。
- 扩展角色、自定义角色、热座多人、纯 Agent 观战、一局多名本地玩家。
- Agent 人格、难度档、策略配置、胜率或牌力评测。
- 原版卡图/版式分发；macOS、Linux、移动端；Windows 安装包/便携 EXE。
- 应用内配置 Claude/OpenCode API key（本机自用复用 CLI 登录态）。
- LangGraph 作为整局编排器；Electron/Tauri 桌面壳。

## Further Notes

- 领域语言以仓库根目录 `CONTEXT.md` 为准。
- Wayfinder 决策地图与研究材料仍是细节来源：`.scratch/coup-ai-mvp/map.md`、`issues/`、`research/`。
- UI 参考原型：`.scratch/coup-ai-mvp/prototypes/core-match/`（抛弃式，选定策划桌变体 B + 对局记录 + 规则介绍）。
- 建议实施顺序：领域核心与测试 → 协议与 SQLite → 本地服务与 WebSocket → Agent 适配器与开局探测 → 网页开局/对局 UI → 恢复与回放 → 按验收清单收口。
- 下一技能步骤：`/to-tickets`，将本规格拆成带阻塞关系的实现票据；每张实现票单独 `/implement`。
