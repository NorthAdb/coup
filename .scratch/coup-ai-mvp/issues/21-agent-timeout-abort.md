# 21 — Agent 超时重试与中止节奏

**What to build:** 真 Agent 决策首次限时 30 秒，可恢复错误再试 15 秒；界面只显示思考/重试等状态；仍失败则技术中止且无胜者，并可走已有快照恢复。

**Blocked by:** 17 或 18（真 Agent）；20 — 持久化、事件回放与快照恢复

**Status:** resolved

- [x] 首次 30 秒硬截止，可恢复错误仅重试一次 15 秒
- [x] 迟到响应丢弃；非法决策不改变权威状态
- [x] 不可恢复错误立即技术中止
- [x] 用户可见状态不含思维链或原始敏感错误
- [x] 中止后可从故障前快照恢复

## Answer

新增 `decideWithBoundedRetry`（`apps/server/src/agentDecision.ts`）：首次 30s、可恢复错误再试一次最多 15s；每次新 `requestId`；迟到响应丢弃。`classifyAgentError` 区分可恢复/不可恢复（协议不受支持等立即中止）。重试提示只带脱敏错误类别，不拼原始响应。`matchRuntime` 经该编排调用适配器；失败走既有 `technicalAbort` / resume。UI 轮询 `GET /api/matches/current/agent-phase`，仅显示思考中/校验中/重试中/失败。编排层截止不强杀在途 CLI（靠丢弃迟到响应保权威状态）；完整节奏动效仍归票 22。
