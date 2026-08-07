# 多房间并行改造决策地图

## Destination

推翻「单房制」（ADR-0004 的「不做多房制」），在保持**纯房号制**产品形态（主机建房 → 4 位房号 → 客人凭号加入，无房间列表）的前提下，让联机版服务器同时承载多个互不干扰的房间：产出修订 ADR-0004 的新 ADR + 一份可交接的多房制改造规格（`spec.md`，对齐 [`coup-internet-multiplayer/spec.md`](../coup-internet-multiplayer/spec.md) 的形态），写清 API 作用域、持久化/恢复、presence、前端改动面与验收，供后续 `/to-spec → /to-tickets → /implement-tickets` 拆票实施。地图只做决策，不实施改造本身。

## Notes

- 本地图只做规划与决策；规格票关闭即到达 Destination。
- 继承 [`coup-internet-multiplayer`](../coup-internet-multiplayer/map.md) 的既有决策：房间≠对局、主机权威、座位凭证回席、离席/回席/处置流程、`lan_active_room` 持久化、host 重启恢复语义——全部按「每房一份」推广到多房，不重开这些账。
- 产品偏好（制图时已钉，细规由子票收口）：**纯房号制**（无房间列表大厅）；**并发房间上限 + 闲置回收**（默认上限 10、闲置 30 分钟，参数子票收口）；一个浏览器同一时刻只处于一个房间（座位凭证 Cookie 单值，保持不变）。
- 领域语言改动时用 `/domain-modeling` 维护根目录 `CONTEXT.md`；注意「单房制」相关词汇（当前 CONTEXT.md 可能有「同一时刻仅一房」的约束，见 ADR-0004）。
- 涉及的技术事实（本会话已探明，子票不必重复探索）：
  - `roomRegistry.ts` 已是多房能力（`Map<code, RoomRecord>`，建房避让房号）。
  - `matchStore.ts` 按 `matchId` 主键存储，天然多对局；**单房强制点**：`findResumableRun()` LIMIT 1、`persistenceForStore.onCreated` 开局即 abort 上一个进行中 run、`match_runs` 表无房间列。
  - **全局单例** `activeMatch` / `activeRoomCode`（`createApp.ts`）+ 全局端点 `/api/matches/current`、`/api/matches/current/decision`（前端 `App.tsx` 7 处轮询）。
  - **建房即解散全部旧房**（`createApp.ts` 的 `POST /api/rooms`，注释 "One active room for now"）。
  - `roomStore.ts` 单行表 `lan_active_room`（固定 id=1）只存一房；`persistActiveRoom()` 只写 `listCodes()[0]`；开机恢复块（`createApp.ts`）是单房恢复。
  - `seatPresenceTracker.ts` 全局一份、按 seatId 裸键（各房座位都是 "1".."6"，跨房必撞）；`trackRemoteSeatsForMatch()` 的 `presence.clear()` 会清掉所有房。
  - 房间号限速（按 IP 失败查询计数）与房号 4 位分配（`allocateRoomCode` 避让活跃房）在多房下仍成立，无需改造。

## Decisions so far

- [钉死房间生命周期参数与房号策略](issues/01-define-room-lifecycle-and-code-policy.md) — 上限 10 房（超限 503 `room_capacity_reached`）；空房=无有效人类座位（match 全离席算空房）；闲置 30 分钟回收、房号即释放；建房暂不限速（上限+回收兜底）；房号保持 4 位；常量集中配置。
- [钉死多房对局的房间作用域与运行时形态](issues/02-define-match-runtime-room-scope.md) — per-room `Map<roomCode, ActiveMatch>`；match 端点房间化 `/api/rooms/:code/matches/current(+/decision)`（前端 App.tsx 7 处带 code）；presence 复合键 `roomCode:seatId` + `clearRoom`；彻底移除单 run 不变量。
- [钉死多房持久化与重启恢复语义](issues/03-define-persistence-and-restart-recovery.md) — 房间表化（`room_code` 主键、旧单行迁移）；`match_runs` 加 `room_code` 列与索引；启动逐房全量恢复、失败房 per-room 状态；abandon 带 roomCode；建房先惰性回收再限额。
- [汇总多房制规格并修订单房制 ADR](issues/04-synthesize-multiroom-spec-and-adr.md) — 交付 [`docs/adr/0007-多房制与纯房号门禁.md`](../../docs/adr/0007-多房制与纯房号门禁.md)（修订 ADR-0004）与 [`spec.md`](spec.md)（产品边界/API/数据模型/生命周期/恢复/验收）；交接 `/to-tickets`。

## Not yet specified

（无。本地图 Destination 已达成：ADR-0007 修订 + 可实施规格已交付。遗留雾区去向：建房后换房流程与恢复失败房复杂 UX → `spec.md` Out of scope；测试矩阵 → `spec.md` 验收标准与 Handoff，交由 `/to-tickets` 拆票时落实。）

## Out of scope

- 房间列表/大厅页、可浏览加入（制图时选项 B，被否）。
- 邀请链接为主的产品形态（选项 C，被否）。
- 一个浏览器同时处于多个房间（多标签各开一房亦属此列；座位凭证单值，保持不变）。
- 公网匹配服、账号体系、跨房间通信/聊天、观战。
- 局域网单机版（`apps/web-local` + `apps/server-local`）与 `packages/domain` 规则引擎：多房只改联机版 `apps/web` + `apps/server`。
- 局域网时代遗留的「重绑跳转」与「本机 Agent」路径（联机版已无，见 ADR-0005）。
