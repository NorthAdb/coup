# 28 — 座位色辨识

**What to build:** 为每个座位按座序固定分配座位色；座位卡明显染色，舞台文案、确认条、对局记录、座位呼出中出现的该座位显示名使用同色，使人不必只靠读名区分座位。座位色是表现层辨识，不是角色牌颜色，不进领域事件。术语见 `CONTEXT.md`（座位色）。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 2–6 人固定调色板，同局内座位色稳定（按座位顺序，不随回合变色）
- [x] 左侧座位卡使用对应座位色（边框/标题等可读染色）
- [x] 舞台、确认条、对局记录、座位呼出中的座位显示名带同色
- [x] 角色牌颜色（公爵/刺客等）与座位色分离，不互相覆盖语义
- [x] 不改 `SeatView` / 领域事件形状

## Answer

`seatColor` 按座序分配 `seat-tint-N`；座位卡染色，`eventParts` / 确认条 / 呼出经 `TextPartsView` 给显示名上同色。角色牌仍用 `ROLE_CARD` tint。
