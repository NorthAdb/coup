# 钉死多房持久化与重启恢复语义

Type: grilling
Mode: HITL
Status: resolved
Blocked by: none

## Question

多房制下，持久化与服务器重启恢复的语义定稿：

- **房间表**：`roomStore` 的单行表 `lan_active_room`（固定 id=1）改为按 `room_code` 主键的房间表，`saveActiveRoom` / `loadActiveRoom` / `clearActiveRoom` 改为全量存/取/清（或按房号增删）。
- **对局关联**：`match_runs` 表加 `room_code` 列（或在房间记录里维护 matchId 已够——`RoomRecord.matchId` 已存在，判断是否需要反查）。`findResumableRun()` 的 LIMIT 1 单房语义改为按房间查询。
- **启动恢复**：开机恢复全部房间：lobby/rematch 房直接恢复；match 房恢复其进行中 run；恢复失败的房间各自进入 per-room 失败状态（现在 `recoveryStatus` / `failedRecoveryRoom` 是全局单房）。
- **恢复失败处置**：`/api/room-recovery/abandon` 及前端放弃流程从单房改为每房独立（放弃一个失败房不影响其他房）。
- **建房解散语义**：`POST /api/rooms` 的「先解散全部旧房」删除，改为在房间表新增一房（受生命周期上限约束）。

推荐：房间表化 + `room_code` 关联 + 全量恢复 + per-room recovery 状态 + 建房不再拆房。

## Answer

### 1. 房间表与 RoomStore API

确定采用房间表化。将 `lan_active_room` 替换为按 `room_code` 主键的表，建议结构为：`room_code TEXT PRIMARY KEY`、`payload_json TEXT NOT NULL`、`created_at INTEGER NOT NULL`、`updated_at TEXT NOT NULL`。`payload_json` 继续保存完整 `RoomRecord`，`created_at` 便于生命周期判断，`updated_at` 便于诊断和惰性回收排序；房间号仍由领域记录中的 `code` 与表主键共同校验。

`RoomStore` API 改为房间维度，并提供启动全量读取：

- `saveRoom(room: RoomRecord): void`：按 `room.code` upsert。
- `loadRooms(): LoadRoomsResult`：返回全部房间；单个 payload 解析失败时返回该房间的失败项，不因一房损坏而丢弃其他房。
- `clearRoom(roomCode: string): void`：只删除指定房间。
- `clearAllRooms(): void`：仅供明确的数据库清理/测试使用，正常建房和 abandon 不调用。

不保留 `saveActiveRoom` / `loadActiveRoom` / `clearActiveRoom` 的单房 API；被否决的“保留单行表并在 JSON 内嵌房间数组”会让 SQLite 无法按房间原子清理、更新和诊断，也会延续单房恢复故障域。

旧单行数据迁移在 `openRoomStore` 初始化时一次完成：先创建新表，读取 `lan_active_room(id=1)`，解析并通过现有 `RoomRecord` 校验后按 `room.code` 插入新表，再在同一事务中删除旧行；没有旧行则直接完成迁移。旧 payload 损坏或无效时不删除旧行，并返回带 `roomCode=null` 的启动级迁移失败，避免静默丢数据；新表中已有同房号时以新表为准并保留旧行供诊断。迁移成功后旧表可保留为空以便回滚观测，但运行时不再读取它。

### 2. 对局与房间关联

确定在 `match_runs` 增加 `room_code TEXT NOT NULL`，并建立索引 `(room_code, run_status, updated_at)`；`match_events` 仍只按 `match_id` 关联 `match_runs`。`RoomRecord.matchId` 继续保留，作为房间当前对局的快速指针和恢复一致性校验，但不作为唯一关联来源。仅维护 `RoomRecord.matchId` 被否决，因为历史对局查房、按房筛选可恢复 run，以及迁移/诊断都必须反查房间记录，容易产生悬挂或跨房误选。

Store API 的所有新建/恢复入口都带房号：`createRun({ roomCode, ... })`、`findResumableRun(roomCode)`、`createResumeRun(roomCode, fromMatchId, newMatchId)`；`getRun(matchId)` 保持按主键读取，另增加必要的 `listRuns(roomCode?)` 过滤能力。`findResumableRun(roomCode)` 必须使用 `WHERE room_code = ? AND run_status = 'in_progress'`，不再使用当前的全局 `LIMIT 1`；同一房间最多保留一个 `in_progress`，但不同房间可并存。

旧 `match_runs` 迁移先以可空 `room_code` 加列，利用旧单行房间的 `matchId` 精确回填对应 run；其余旧 run 标记为迁移异常并不得被恢复为任何房间。回填校验通过后再收紧新写入为非空。`createResumeRun` 必须复制来源 run 的 `roomCode`，同时将新 run 的 `resumedFromMatchId` 指向来源；不得因新建续局而触碰其他房间。

这也直接修正当前 `persistenceForStore.onCreated` 的单房副作用：它目前调用无参数的 `findResumableRun()` 并 `userAbort` 上一个全局进行中 run。改为接收 `roomCode`，只检查并处理该房间；正常的同房重开仍可按既有门禁结束上一 run，跨房绝不作废。

### 3. 启动全量恢复

启动时先 `loadRooms()`，再逐房处理，不能再由 `activeRoomCode` / `activeMatch` 表示全局唯一活动房。每房产生独立的恢复记录：`none`、`restored` 或 `failed`，失败项至少包含 `roomCode`、`reason` 和可展示的 `RoomRecord` 摘要；一个房间失败不得阻止其他房间恢复。

- `lobby`：校验房间记录后直接放回 registry，标记 `restored`；不读取或创建 match run。
- `rematch`：校验房间记录及其已结束的 `matchId`（若存在），直接恢复续局等待，标记 `restored`；不把已结束 run 当作进行中对局。
- `match`：必须有 `matchId`，且 `getRun(room.matchId)` 存在、`room_code` 与房号一致、`runStatus === "in_progress"`；通过后恢复该房的 `ActiveMatch`，并按房号重建 presence，标记 `restored`。
- 缺少 `matchId`、找不到 run、房号不一致、run 非 `in_progress`、payload 无效或存在迁移错误：该房标记 `failed`，保留失败房记录供 abandon，其他房继续启动。

当前启动块只读单房，并且对 match 严格检查 `runStatus !== "in_progress"` 即失败；这个校验应保留，但改为每房校验。`trackRemoteSeatsAfterAuthorityRestore()` 当前会清空全局 presence，恢复后要改为按 `roomCode` 隔离并只给该房远程座位发恢复宽限。`activeMatch`、`activeRoomCode` 及全局当前对局端点不是本票可继续保留的恢复模型，必须由后续运行时/API 改造改为按房路由。

恢复过程中不得调用会创建新 run 的 `startMatch`。只有收到该房明确的正常 `/start` 请求才创建新 run；`persistenceForStore.onCreated` 在该路径接收房号并执行同房检查。其 `onCreated` 失败或启动后的持久化异常仍应对该房执行 `technicalAbort`，而不是通过全局 `findResumableRun()` 猜测刚创建的 run；`matchId` 必须从本次创建上下文显式传递。

### 4. 房间化 abandon

`GET /api/room-recovery` 改为返回所有恢复结果，至少包含 `rooms: [{ code, status, reason, phase, matchId, seats }]`；可额外保留按房号查询的接口，但不能再返回一个全局 `failedRecoveryRoom`。`POST /api/room-recovery/abandon` 必须携带 `roomCode`，只处理该房：若其 `matchId` 对应 run 仍为 `in_progress`，先以 `host_restart_abandoned` 执行 `technicalAbort`；随后从 registry 删除该房、`clearRoom(roomCode)`、删除该房恢复状态、清理该房 presence 和运行时引用。

放弃一个失败房不得 dissolve 其他房、清空所有房间表、清空其他房的 presence，也不得重置其他房的恢复状态。当前实现从 `failedRecoveryRoom` / `activeRoomCode` 取一个 matchId 后遍历 `rooms.listCodes()` 全部 dissolve 并 `clearActiveRoom()`，这是必须删除的单房副作用。对已恢复房的 abandon 也按同一房号执行，明确表示主机放弃该房；若产品最终只允许失败房 abandon，接口应对 `restored` 返回明确 409，而不能误清全局状态。

### 5. 建房、生命周期上限与失败房

删除 `POST /api/rooms` 中“先解散全部旧房”的循环；创建成功只向 registry 和房间表新增一房。创建前先执行一次惰性生命周期回收：删除已满足生命周期规则的闲置房及其房间记录/房间级运行时状态，再检查并发上限。采用地图约定的默认并发上限 10、闲置 30 分钟；未达到上限就创建，达到上限且没有可回收房则返回稳定的 409（例如 `room_limit_reached`），绝不静默解散仍在使用的房间。

生命周期时间戳必须进入 `RoomRecord` 持久化语义（至少维护 `lastActivityAt`，或由等价的 `updated_at` 明确定义），房间状态变更、占座/回席、续局操作和该房对局命令成功提交时更新；只读查询不应延长寿命。闲置判定的精确定义和扫描/惰性触发仍由生命周期参数票收口，但本票钉死其与建房的连接：创建入口先回收、再限额、最后新增，不能用“新房替换旧房”绕过上限。

恢复失败房在生命周期上应计入并发上限，直到逐房 abandon 或明确过期回收；否则重启后反复创建可无限积累无法处理的持久化垃圾。恢复中的 `match` 房也不能因“建了新房”被隐式作废，只有该房自己的 abandon、生命周期回收或既有对局终止语义可以结束它。纯房号制和按 IP 失败查询限速保持不变，不引入房间列表或跨房加入入口。

## Comments

- 人工批准（2026-08-07）：提案定稿为 Answer。
