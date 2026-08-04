# 25 — 决策说明旁路与 hover

**What to build:** Agent 在提交结构化座位决策时可附带一句可选决策说明。校验通过后，说明仅保存在本局内存（每座位最近一条）。玩家 hover 该 Agent 座位可看到说明，并区分「Agent 说明」与「根据决策生成」的模板兜底。思考中仍只显示阶段状态提示；不展示思维链或原始 transcript，也不写入权威历史。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 适配器可返回可选决策说明；权威路径仍只校验结构化座位决策
- [x] 说明为协议/运行时旁路：本局内存、每座位仅保留最近一次；不进领域事件、SQLite 或回放
- [x] 缺省或不可用时用结构化决策的模板文案兜底，浮层标明来源（Agent 说明 vs 根据决策生成）
- [x] 思考/重试等阶段仍只显示阶段提示；决策落地后才可 hover 查看说明
- [x] 禁止展示或持久化原始思维链 / provider transcript（与 ADR-0001 一致）

## Answer

适配器返回可选 `decisionRationale` 旁路；权威仍只校验 `SeatDecision`。`resolveDecisionRationale` 优先 Agent 原文，否则模板兜底并标 `source`。本局内存 `decisionRationales` 经 API 旁路下发，不进 SeatView/SQLite。座位 hover 显示来源标签；思考中该座不展示说明。
