# 汇总多房制规格并修订单房制 ADR

Type: task
Mode: HITL
Status: resolved
Blocked by: 01 钉死房间生命周期参数与房号策略, 02 钉死多房对局的房间作用域与运行时形态, 03 钉死多房持久化与重启恢复语义

## Question

把全部已解析决策汇总为可交接的交付物：

- 新 ADR（`docs/adr/0006-*.md`）：修订 ADR-0004 的「不做多房制」，记录多房制决策（纯房号制、上限+闲置回收、per-room 运行时/持久化/presence、移除单 run 不变量），并列出被否决的备选（房间列表、邀请链接为主、环境开关等）。
- `spec.md`（`.scratch/coup-multi-room/spec.md`）：多房制改造规格，对齐 `coup-internet-multiplayer/spec.md` 形态——产品边界、API 形态（房间作用域端点）、数据模型（房间表、`room_code` 列）、恢复语义、前端改动面、验收标准（含多房并发用例：两房同时开局互不干扰、重启恢复多房）、Out of scope。
- 若领域语言有变化（如「同一时刻仅一房」约束从 CONTEXT.md 移除），同步 `/domain-modeling`。

交付后地图关闭：本票即 Destination。
## Comments

---

**草稿交付（待人工审批）**：已生成 `docs/adr/0007-多房制与纯房号门禁.md`（因 `0006-续局全员确认门禁` 已占用编号，多房制 ADR 定稿为 0007）。记录修订 ADR-0004、纯房号多房制、10 房上限/30 分钟回收、per-room runtime/presence、房间表与逐房恢复；备选与否决理由齐备。

已生成 `.scratch/coup-multi-room/spec.md`。规格覆盖产品边界、房间作用域 API、`App.tsx` 7 处调用点、数据迁移、生命周期、恢复和并发验收；待人工确认建房满额错误码及未定义的换房/恢复失败 UX。

- 人工批准（2026-08-07）：交付物定稿，本票即 Destination，地图关闭。
