# 17 — OpenCode 真 Agent 座位

**What to build:** 某一 Agent 座位改用本机 OpenCode：收到 SeatView，仅返回结构化 SeatDecision，禁用外部工具；能在真实对局中作出合法行动。

**Blocked by:** 15 — 完整角色行动与规则边界（Stub）；16 — 开局配置页

**Status:** resolved

- [x] 开局可为某座位选择 OpenCode
- [x] 该座位只看到投影后的 SeatView，看不到对手隐藏牌
- [x] 决策经协议与领域校验后才生效
- [x] 外部工具全部禁用
- [x] 浏览器不持有 OpenCode 凭据

## Answer

实现统一 `AgentSeatAdapter` 与 OpenCode 适配器：开局可选 OpenCode；runtime 按座位 `cli`/`modelId` 调用适配器。适配器只收到 `toSeatView` 投影，返回 `legalDecisionIndex`→`SeatDecision`，经协议版本/`requestId`/`stateVersion`/`legalDecisions` 校验后再 `applyCommand`。座位工作目录写入 `permission: { "*": "deny" }` 的 `opencode.json`，且不传 `--auto`。CLI 仅由本机服务以 argv 子进程启动，浏览器不持凭据。MVP 采用 research 批准的 `opencode run --format json` 简化路径（相对 architecture 首选的 `serve`）；完整探测门禁仍归票 19。
