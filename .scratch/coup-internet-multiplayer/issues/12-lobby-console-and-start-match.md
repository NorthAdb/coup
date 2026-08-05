# 12 — 指挥台大厅配置与开局对局

**What to build:** 大厅采用指挥台信息架构（左栏邀请与开局门禁，右栏座位矩阵）。主机将其余座位设为开放占座、本机 Agent 或关闭；仅当有效座位 2–6、无开放空槽且 Agent 就绪（可重新检测，开始时服务端复检）时主机可开局。开局后进入现有策划桌；远程人类与主机本地人类（及可选本机 Agent）能为各自座位提交座位决策并完成至少若干回合的可玩对局。不强制开局前已有远程人类占座。

**Blocked by:** 11 — 多 Origin 会话与座位凭证占座

**Status:** resolved

- [x] 大厅 UI 对齐指挥台变体 B：左邀请/门禁、右座位矩阵；客人无开局按钮
- [x] 主机可配置开放占座 / 本机 Agent / 关闭；门禁文案在未满足时阻止开始
- [x] 开局后各人类座位进入策划桌投影，远程人类决策经权威引擎校验生效
- [x] 可混入本机 Agent；Agent 凭据与 CLI 仅在主机侧

## Answer

- 大厅：主机指挥台左右栏（邀请+门禁 | 座位矩阵）；客人仅占座/改名，无开局按钮；`phase=match` 后轮询进入策划桌。
- 配置：`PATCH /api/rooms/:code/seats/:seatId/config`（仅座 1 凭证）；槽 kind=`open`/`local_agent`/`closed`；已占远程在 UI 标「已占」，主机改配会清凭证。
- 开局：`POST /api/rooms/:code/start`；门禁有效座 2–6、无开放空槽；前端按能力探测挡按钮，服务端 `recheckSetupSeats` 复检；不强制远程人类。
- 对局：领域 `SeatController` 含 `remote_human`；按 `coup_seat` 投影与提交决策；`pendingAgentSeatIds` 仅认 `stub_agent`。
