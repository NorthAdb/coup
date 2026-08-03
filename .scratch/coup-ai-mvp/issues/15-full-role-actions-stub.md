# 15 — 完整角色行动与规则边界（Stub）

**What to build:** 在 Stub Agent 下打完含征税、刺杀、偷窃、交换的完整基础局，覆盖证明/认输、揭示、淘汰、胜负，以及已决议的费用与阻挡边界；用 Stub 即可从开局打到有胜者。

**Blocked by:** 14 — 外援、政变与响应窗口

**Status:** resolved

- [x] 征税、刺杀、偷窃、交换均可按规则结算
- [x] 证明与认输、揭示选牌、淘汰与获胜正确
- [x] 刺杀费用退回/不退、失败阻挡不重开等边界成立
- [x] Stub 对局可从开局进行到只剩一名未淘汰参与者
- [x] 领域核心对关键边界案例有确定性测试

## Answer

在 `packages/domain` 落地完整角色行动状态机：`await_action_challenge`、目标限定阻挡（刺杀伯爵夫人 / 偷窃大使或队长）、`await_exchange_selection`，以及 `revealFollowUp` 驱动的证明/放弃证明后续。刺杀 3 币声明时预扣：行动声明被推翻则退回（已淘汰座位不退币），被成功阻挡则不退；失败阻挡不重开窗口。协议 `SeatView.privateState.exchangeHand` 仅对交换座位可见；Web 增量启用征税/刺杀/偷窃/交换与交换选牌；Stub 仍取 `legalDecisions[0]`，runtime 测覆盖刺杀打到胜者。
