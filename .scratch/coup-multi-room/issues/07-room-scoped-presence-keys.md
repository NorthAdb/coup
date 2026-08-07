# 07 — presence 房间作用域键

**What to build:** 座位在场追踪按「房间号 + 座位号」复合键隔离，清理操作按房间维度提供，对外投影仍保持房间内的裸座位号；同一座位号在不同房间可独立追踪。

**Blocked by:** None — 可立即开工

**Status:** done

- [ ] 同座位号（如两房都是 1 号）在不同房间可独立追踪心跳与离席状态
- [ ] 按房间清理接口可用；全量清理仅用于进程级销毁路径
- [ ] 现有离席/回席/处置行为回归不变：15 秒宽限、5 分钟软超时、恢复宽限

## Comments

- 已完成：presence tracker 改为 `roomCode:seatId` 复合键，新增按房间投影与 `clearRoom`，`clearAll` 仅用于进程级销毁；所有服务端心跳、离席、回席、处置、终局和恢复调用均显式绑定房间号。
- 新增跨房同座位独立追踪与按房清理测试；`npm run typecheck`、`npm test` 全部通过，服务端测试 69 项通过。
- Commit: `0356479` (`Scope seat presence by room`)
