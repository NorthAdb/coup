# 15 — 房主弃房回收：大厅空房定义与轮询计活

**What to build:** 让闲置回收真正可触发：大厅/续局等待阶段，房间没有远程人类座位即视为空（房主座位不再令房间永活），空房连续 30 分钟无活动即回收；房主开着大厅页（轮询房间快照）计入活动时间，避免「等朋友时被回收」。

**Blocked by:** None — 审查后续修复

**Status:** done

- [ ] 大厅/续局等待房的空房判定改为「无远程人类座位」；进行中房判定不变（本地人类恒有效）
- [ ] 大厅房间快照轮询（获取房间信息）计入活动时间；其余只读查询不延长寿命
- [ ] 空房连续 30 分钟无活动回收、房号释放；重新出现客人（远程人类占座）即取消计时
- [ ] 回归：全量 typecheck + 测试全绿

## Comments

- Implemented lobby/rematch emptiness based on remote human seats, while preserving in-progress match semantics.
- Room snapshot polling now refreshes idle activity; other read-only room queries do not.
- Added lifecycle and HTTP regression coverage for reclaim timing, room-code release, polling activity, and non-polling reads.
- Verification: `npm run typecheck` and `npm test` passed.
- Commit: `1a559e1` (`Reclaim abandoned lobby rooms`)
