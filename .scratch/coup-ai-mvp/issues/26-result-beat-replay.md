# 26 — 结果节拍表现层回放

**What to build:** 权威一次推进后，客户端按新增公开事件做结果节拍回放：重拍在中央舞台播「刚才发生」并停住可读；轻拍以座位呼出短闪为主；回放结束后再显示真实当前阶段。不倒带钱币/手牌，不改领域/Agent 协议；右侧记录仍只做回顾。见 ADR-0002。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 重拍：`action_failed`、`claim_proven`/`claim_conceded`、`influence_revealed`、`seat_eliminated`（可含回放结束前「轮到你」收束）
- [x] 轻拍：普通声明/结算、`response_passed`、`turn_advanced` 等不占舞台长停
- [x] 平衡约 1.6–2.2s 重拍、0.4–0.7s 轻拍；快速缩短；减动效仍保留可读文案
- [x] 回放期间锁定行动；结束后恢复 live 舞台；亮牌/补牌 overlay 与座位呼出协调
- [x] 不倒带权威公开数字；不把对局记录当成主阅读面

## Answer

表现层按 `buildResultBeatSteps` 回放新增事件：重拍占中央舞台「刚才发生」，轻拍仅呼出短停；回放锁行动，结束后可「轮到你」收束再回 live。见 ADR-0002 与 `resultBeat.ts`。
