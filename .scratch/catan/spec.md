# 卡坦岛（Catan）高保真 Web UI 原型 · spec

状态：第一阶段（UI + 交互 + Mock 对局状态）已完成。入口 `/catan`，纯前端，零服务端改动（服务端 not-found 已把非 `/api` GET 回给 `index.html`）。

## 目标与边界

- 目标：让用户第一眼感觉是「商业化的高级数字桌游」——高级实体桌游被数字化后的在线桌面体验。视觉元素优先级：**地图 > 六边形地块 > 建筑 > 资源卡 > 玩家区域 > 交易 > UI 控件**。
- 第一阶段刻意不做：完整规则（起始放置流程、>7 弃牌、出牌当轮限制）、后端、多人同步、持久化。刷新即重开；房间/座位是本地 Mock。
- ✅ 已落地（2026-09，ADR-0013）：`packages/catan-domain` + `apps/server/src/catan/`（catanModule/catanRuntime/catanStore）+ `createApp` 挂载 + `createRoomClient("/api/catan")` 薄壳（`catanApi.ts`）；`mock/` 与 `useCatanGame` 已删除。同轮落地平台层 AI 队友座位（四款游戏大厅「加AI」，卡坦首页一键开局=建房+三AI）。

## 文件结构（全部在 `apps/web/src/catan/`）

| 文件 | 内容 |
|---|---|
| `CatanApp.tsx` | 应用壳：首页（开始/创建/加入/玩法）→ 创建房间（名称/人数/公开私密）→ 等待大厅（房号 + AI 陆续入座就绪）→ 对局。深链 `/catan/play` 快速开局；`/catan/play#demo-win` 演示终局 |
| `mock/types.ts` | 类型与常量（地形/资源/成本表/FloatChip） |
| `mock/game.ts` | Mock 引擎：纯函数、无 IO、无 React。内部 mulberry32（`g.rngState`）保证确定性可测 |
| `mock/game.test.ts` | 13 项引擎单测（node:test，走 `--experimental-strip-types`，import 用 `.ts` 后缀） |
| `table/BoardMap.tsx` | SVG 海图棋盘：海域/海岸/港口/地块/Token/棋子/交互层/确认气泡 |
| `table/pieces.tsx` | 设计系统棋子：地形插画、NumberToken、道路/村庄/城市/强盗、港口场景、资源图标/卡牌/发展卡/骰子 |
| `table/useCatanGame.ts` | 状态钩子：引擎动作包装、AI 回合分阶段调度（可取消）、事件→动画（骰子/Token 点亮/飘卡/落位/toast） |
| `table/CatanTable.tsx` | 桌面布局：围坐玩家区、手牌、发展卡、行动面板、骰子盘、交易面板、强盗条、受害者浮层、胜利结算、玩法弹窗 |
| `catan.css` / `catan-pieces.css` / `catan-table.css` | 设计令牌与首页/大厅；棋子与卡牌；桌面布局与浮层。前缀 `--ct-` / `.ct-`，与其他游戏样式完全隔离 |

## 设计系统要点

- 字体：标题 `Georgia/Palatino/Songti` 衬线（历史感），正文 `Segoe UI/PingFang` 无衬线。
- 色：深胡桃木 + 深绿丝绒 + 羊皮纸 + 黄铜金；玩家四色低饱和（陶红 `#b3573f` / 黛蓝 `#3f6d8e` / 橄榄 `#5d7048` / 赭金 `#c9973f`），同时用于建筑、道路、徽章、日志色点。
- 动画纪律：动画只服务于「行动 → 反馈 → 状态变化」（掷骰 0.8s → Token 点亮 2.2s → 飘卡 1.65s → 落子弹入 0.6s），全部尊重 `prefers-reduced-motion`。

## Mock 引擎的关键决策

- 棋盘：19 陆地格（4/4/4/3/3/1），token 洗牌至 6/8 不相邻（实体版摆放规则）；9 港口取海岸边按极角均匀分布，类型 4 通用 + 5 专属洗牌。
- 几何：axial 坐标 pointy-top，顶点/边按坐标取整去重（浮点 1e-5 稳键），单位 = 六边形外接圆半径。
- 开局：蛇形序（0,1,2,3,3,2,1,0）预置两村两路 + 起始手牌（人类固定一手可行动资源，AI 随机 4 张）——模拟「已完成初始布置」的中盘。
- 距离规则：初始路的远端点与自家村庄相邻（距离 1），永远不满足建村距离，必须先延伸道路——这是实体规则，不是 bug；UI 在无合法位时给内联提示。
- `respondTrade` 验资失败必须清掉 `pendingTrade` 并落日志（提议作废），否则提议永久挂起（实测踩过）。
- AI 回合按阶段分步调度（roll → robber → main），效果以 `turn:phase:winner` 为键重跑并取消旧例程；AI 决策每步读 `gameRef.current`，构建/交易全部走引擎校验，失败静默跳过。
- 引擎动作返回 `{ ok, game, events }`，events 驱动 UI 动画；任何 UI 层随机（AI 决策）用 `Math.random`，引擎内随机一律走 `rngState`。

## 已知留白（第二阶段清单）

- 初始放置回合、>7 弃牌、发展卡「打出当轮限制」、最多村庄/城市库存上限（当前只按成本校验）。
- 多人同步、断线回席、观战、超时代打——全部等平台接入后免费获得。
- 地形插画可再放大一档（当前在 103px 地块上偏精细）；窄屏 (<700px) 未做触控优化。
