# 14 — 主机重启后的房间与对局恢复



**What to build:** 大厅与已开局对局均持久化。主机进程重启后恢复同一房间；若已开局则继续同一对局 run（同一 matchId 与事件序号），不是 technical_abort 后的新恢复运行。宕机期间冻结离席软超时，恢复后再给短宽限。客人在原 Origin 自动重试回席，Origin 变化则用新加入链接 + 座位凭证。Agent 槽重绑并探测，未就绪则决策点暂停。恢复失败时主机显式提示，须放弃并作废旧房后才能开新房。



**Blocked by:** 13 — 离席、回席与主机处置



**Status:** resolved



- [x] 重启服务后未结束房间（大厅或对局中）可恢复；已开局续同一 run

- [x] 宕机时长不计入离席软超时；恢复后短宽限与回席可用

- [x] 客人原 Origin 自动回席，或经新链接 + 凭证附着

- [x] 恢复失败有明确文案；作废旧房间号与凭证后才能创建新房，不静默顶替



## Answer



- **持久化**：同库新表 `lan_active_room`（`roomStore.ts`）保存活动房间（code / phase / seats / credential hashes / matchId）；房间变更后写入，解散或放弃时清除。

- **启动恢复**：`createApp` 读回房间；`phase=match` 时绑定未结束 run，继续同一 `matchId` 与事件序号（**不是** `technical_abort` → `createResumeRun`）。大厅只恢复房间。

- **离席钟**：权威宕机不 tick；恢复后 `grantRecoveryGrace` 给相关远程座重新 15s 宽限，其后规则同 ticket 13。

- **客人回席**：凭证哈希随房持久化；同 Origin + `coup_seat` 可 `/me` / `resume-seat`；主机不可达时客人页提示并重试原 Origin。

- **恢复失败 / 禁止静默顶替**：`GET /api/room-recovery`；`failed` 或 `restored` 时 `POST /api/rooms` 均 `recovery_pending_abandon`；须 `POST /api/room-recovery/abandon`（作废房间；可归因未结束 run → `technical_abort:host_restart_abandoned`）后才能开新房。

- **Agent**：槽配置随房间/对局快照保留；恢复后由既有探测/推进路径重绑，未就绪不因重启本身强制淘汰。

- **UI**：首页失败态「放弃并开新房间」；启动时按座位凭证区分主机/客人恢复入口；客人见房 404 提示「房间已失效，可离开」。

- **未做（辅路径）**：Origin 变更后的凭证粘贴呈递无单独 UI；依赖新加入链接与 Cookie 策略。

关键代码：`roomStore.ts`、`createApp.ts`、`seatPresenceTracker.ts`、`roomRegistry.ts`；测试 `roomStore.test.ts`、`roomRecoveryApi.test.ts`；web `lanRoom.ts`、`App.tsx`、`HomeEntry.tsx`。

