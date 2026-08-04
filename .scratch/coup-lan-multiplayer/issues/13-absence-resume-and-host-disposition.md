# 13 — 离席、回席与主机处置

**What to build:** 远程人类实时通道断开后先有 15 秒宽限（重连中），仍未恢复则标记离席并启动 5 分钟软超时；若正轮到该座则对局在该决策点暂停，否则可继续至下次需要该座。座位卡与对局右侧抽屉展示等待状态。主机可继续等待、换本机 Agent、技术中止或强制揭示淘汰；软超时后必须选择。客人凭座位凭证刷新或重连可回席（成功则轮换凭证）；软超时本身不作废凭证。

**Blocked by:** 12 — 指挥台大厅配置与开局对局

**Status:** resolved

- [x] 断线经历宽限 → 离席 → 软超时的状态与可见倒计时符合规格
- [x] 暂停规则正确：仅在需要该座决策时挡住推进
- [x] 主机四处置可用且效果正确（含换 Agent/淘汰时作废旧凭证）
- [x] 持凭证回席认回原座并轮换新凭证；对局抽屉信息架构可理解

## Answer

- **状态机**：`seatAbsence` + `seatPresenceTracker`（心跳 lease 4s → 断线回溯）— 15s `reconnecting` → 5min `absent` → `timed_out`；可注入 `now`。
- **API**：`POST .../heartbeat`、`GET .../presence`、`POST .../resume-seat`（轮换 `coup_seat`）、`POST .../seats/:id/disposition`（`extend_wait` / `swap_agent` / `technical_abort` / `force_eliminate`）。
- **暂停**：仅当欠决策座处于 `absent`/`timed_out` 时 `pausedForAbsenceSeatId`；宽限不暂停。
- **领域**：`forceEliminateForHostAbsence` + 事件 `host_absence_elimination`。
- **UI**：策划桌右侧轨 `AbsenceDrawer`（座位卡状态 + 主机四处置 / 客人回席）。
- **测试**：`seatAbsence.test.ts`、`absenceApi.test.ts`；软超时本身不废凭证。
