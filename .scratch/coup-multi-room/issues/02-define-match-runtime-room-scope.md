# 钉死多房对局的房间作用域与运行时形态

Type: grilling
Mode: HITL
Status: resolved
Blocked by: none

## Question

多房并行下，对局运行时与 API 的作用域形态定稿：

- **运行时**：全局单例 `activeMatch` / `activeRoomCode`（`createApp.ts`）改为 `Map<roomCode, ActiveMatch>`（每房一份进行中对局）；`tickPresence`、`resolveMatchSeatId`、开局、终局等路径全部按房间取运行时。
- **match API**：`/api/matches/current` 与 `/api/matches/current/decision` 是全局端点（前端 `App.tsx` 7 处调用），改为房间作用域 `/api/rooms/:code/matches/current`（推荐，前后端同仓库同发布、无兼容期），还是保留全局 URL + 凭据反查房间。
- **presence 键空间**：`seatPresenceTracker` 按 seatId 裸键（各房都是 "1".."6" 必撞），改复合键 `roomCode:seatId`（推荐，改动最小）还是每房一个 tracker；`presence.clear()` / `trackRemoteSeatsForMatch()` 等调用点改为房间作用域（开局、终局、处置都不能再清别的房）。
- **开局语义**：`persistenceForStore.onCreated` 开局 abort 上一个进行中 run 的「单 run 不变量」是否彻底移除（多房下每房一局，互不 abort）。
- 前端需要的最小改动面（`lanRoom.ts` 持单 code + `App.tsx` 轮询 URL 加 code）确认。

推荐：per-room Map 运行时 + 房间作用域 match 端点 + `roomCode:seatId` 复合键 + 移除单 run 不变量。
## Answer

### 1. Per-room 运行时形态

确定采用 `Map<string, ActiveMatch>`，键为 `roomCode`，值为该房间当前对局的 `ActiveMatch`。移除全局 `activeMatch` / `activeRoomCode`；请求先按 `:code` 取得房间，再按该 code 取得运行时。房间不存在或没有运行时分别返回房间/对局错误。

- 启动恢复：按持久化房间逐房读取 `room.matchId` 对应的 run，写入 `matchesByRoom`，并只为该房间建立 presence 恢复宽限期；恢复失败只影响该房间。
- 开局：`POST /api/rooms/:code/start` 调用现有 `startMatch({ persistence })`，成功后绑定该房间，再执行 `rooms.beginMatch`、持久化和该房间的远程座位追踪；失败只清理该房间 Map 项。
- 决策、轮询、离席处置和 tick 都按 code 查找；决策结果只替换该房间的 `ActiveMatch`。
- 终局保留该房间的 finished runtime 供结果页/续局等待使用；技术中止、解散或新 run 启动时删除该项并清理该房间 presence，绝不影响其它房间。

理由：`matchRuntime.ts` 的 `startMatch`、`submitHumanDecision`、`toSeatView` 均通过显式 `ActiveMatch`/`matchId` 工作，没有全局依赖；单房耦合集中在 `createApp.ts` 的两个变量、恢复、开局、终局和处置路径。因此只在应用编排层按房间包住现有 runtime 是最小改动。拒绝“每房独立应用实例”：会扩大生命周期、路由和资源管理面，现有 runtime 已足够无状态化。

### 2. Match API 房间作用域

确定采用以下 URL，不保留全局 URL 的凭据反查：

- `GET /api/rooms/:code/matches/current`
- `POST /api/rooms/:code/matches/current/decision`

两路由先校验 `rooms.getByCode(code)`，再从 `matchesByRoom.get(code)` 取 runtime；`resolveMatchSeatId` 接收 code，只在该房间内用座位凭证解析。`humanFacingPayload` 和 `toSeatView` 继续接收显式 runtime/座位号，无需改成全局查找。

App.tsx 需要改的 7 个请求点，均使用当前已有的 `room.code`：恢复房间 `enterMatchIfPossible`（约第 93 行）、按房间号进入发现 match（约第 185 行）、`resumeLanMatch`（约第 259 行）、`submitDecision`（约第 288 行）、`refreshLobby`（约第 457 行）、match 轮询 `refreshMatch`（约第 521 行）、`handleResumeSeat`（约第 642 行）。

理由：lobby、heartbeat、resume、disposition 已全部使用房间路径参数，match 补上同一作用域即可消除服务器对“当前房间”的猜测，并防止跨房凭据误用。拒绝“全局 URL + 凭据反查”：单值座位凭证不能表达路由意图，会把多房隔离重新压回隐式全局状态。

### 3. Presence 键空间与房间化调用

确定采用 tracker 内部复合键 `roomCode:seatId`，不采用每房一个 tracker。`seatPresenceTracker.ts` 仍可保留一个 tracker，但 Map 的 create/lookup/delete 必须使用房间作用域 helper；对外投影去掉前缀，返回当前房间的裸 seatId。将全局 `clear()` 改为 `clearRoom(roomCode)`，另提供仅供进程级销毁使用的 `clearAll()`，所有 seat 操作带 roomCode。

必须房间化的调用点：

- `tickPresence(code)`：只清理该房间非远程座位并 tick；不能按裸 seatId 清理其它房间。
- `trackRemoteSeatsForMatch` 与 authority restore：开局/恢复只 clear 该房间，再 track、noteHeartbeat 或 grantRecoveryGrace 该房间座位。
- heartbeat 和 presence GET：track、noteHeartbeat、tick、projectAll 只作用于 `:code`。
- resume：本地座位 clearSeat，远程座位的 track/get/resume/noteHeartbeat 全部带 code。
- disposition：tick/get/extendWait、technical abort 的清理、force eliminate 的 clearSeat 全部带 code。
- match GET/decision：blocksAdvancement、离席判断、恢复 grace、终局清理全部带 code。
- recovery abandon/进程级销毁可以 clearAll，但必须同时删除对应房间 runtime；普通房间路径禁止全局 clear。

理由：当前 tracker 按裸键 `"1"` 到 `"6"` 存储，跨房必撞；复合键只需改变键生成和调用参数，避免维护 tracker Map 的双重生命周期。拒绝“每房一个 tracker”：隔离更直观，但会把 tracker 的创建、恢复、销毁和注入扩散到所有调用点，改动大于复合键方案。

### 4. 单 run 不变量

确定彻底移除。`persistenceForStore.onCreated` 不再调用 `findResumableRun()` 并 abort 旧 run；开局错误处理、房间 start 的旧 run abort、决策异常/技术中止也只能操作当前 room 的 `matchId`。持久化层已有按 `matchId` 的 run/event 主键，`matchRuntime` 也已按 match 对象工作；跨房恢复仍需由每房 `room.matchId` 精确选择，不得继续使用 `findResumableRun()` 的 LIMIT 1 作为运行时来源。

拒绝“保留单 run 作为全局安全阀”：它会让第二房开局直接中止第一房，正好违反每房一局、互不 abort 的目标。

### 5. 前端最小改动面

`lanRoom.ts` 已在 `RoomInvite` 和各房间 API helper 中持有/传递 `code`，因此无需新增全局房间状态或改座位凭证模型；只需把上述 7 个 `App.tsx` match fetch URL 改为带 `room.code`，并确保调用发生时 `room` 非空。现有 lobby 轮询、终局轮询、heartbeat、resume、处置调用已经带 code，保持不变。服务器返回的 presence 仍使用房内裸 seatId，避免扩大协议和 UI 改动。

本票结论为：per-room runtime Map、房间作用域 match API、`roomCode:seatId` presence 复合键、移除单 run 不变量；不保留全局 match URL，也不新增每房 tracker 或前端多房并存状态。

## Comments

- 人工批准（2026-08-07）：提案定稿为 Answer。
