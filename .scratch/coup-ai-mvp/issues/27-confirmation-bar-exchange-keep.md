# 27 — 确认条与大使保留选牌

**What to build:** 本地人类声明行动（含目标）与大使选牌经确认条提交：先形成草稿，CONFIRM 才成为座位决策，CANCEL 只清草稿。确认条与响应条共用中央底部槽位、互斥。大使 UI 改为从候选中选择要保留的影响力，确认条摘要「保留 X 与 Y」；领域仍用 `returnCardIds`，不改协议形状。见 ADR-0003；术语见 `CONTEXT.md`（确认条）。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 无目标行动：点行动写入草稿 → 确认条可 CONFIRM；CANCEL 清空
- [x] 有目标行动：点行动后点座位补全草稿 → 确认条摘要含目标后可 CONFIRM
- [x] 大使 `await_exchange_selection`：展示候选牌，点选保留（2 影响力时选 2；1 影响力时按规则选保留张数），确认条「保留 …」后提交；客户端把未保留牌映射为 `returnCardIds`
- [x] 确认条与响应条互斥占同一中央底部槽；底部行动栏保留，草稿未确认前可改选
- [x] 质疑/阻挡/放弃/揭示/证明不走确认条；Agent 不走确认条
- [x] 不拉长结果节拍；不改领域交换保密与命令形状

## Answer

表现层 `actionDraft` / `exchangeKeep` + `MatchDesk` 确认条：声明行动与大使选牌经草稿 Confirm 提交；交换 UI 按保留选牌并映射 `returnCardIds`。见 ADR-0003。
