# 17 — OpenCode 真 Agent 座位

**What to build:** 某一 Agent 座位改用本机 OpenCode：收到 SeatView，仅返回结构化 SeatDecision，禁用外部工具；能在真实对局中作出合法行动。

**Blocked by:** 15 — 完整角色行动与规则边界（Stub）；16 — 开局配置页

**Status:** ready-for-agent

- [ ] 开局可为某座位选择 OpenCode
- [ ] 该座位只看到投影后的 SeatView，看不到对手隐藏牌
- [ ] 决策经协议与领域校验后才生效
- [ ] 外部工具全部禁用
- [ ] 浏览器不持有 OpenCode 凭据
