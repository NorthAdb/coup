# 22 — 策划桌 UI 打磨

**What to build:** 对局界面达到已定原型：左侧座位、中央舞台与响应条、右侧对局记录、底部合法行动栏、顶栏规则介绍；克制亮牌/补牌动效；平衡/快速节奏；Chrome/Edge 桌面窗口下可用。

**Blocked by:** 15 — 完整角色行动与规则边界（Stub）；16 — 开局配置页

**Status:** resolved

- [x] 布局符合策划桌方案
- [x] 规则介绍可打开/关闭
- [x] 质疑亮牌与补牌动效克制可用
- [x] 平衡与快速节奏可切换，并尊重减少动态效果
- [x] 占位卡面为深色权谋风；Chrome/Edge 常见桌面视口可用

## Answer

对局页改为策划桌布局（`MatchDesk`）：左座位、中舞台+响应条、底手牌/合法行动栏、右对局记录、顶栏规则介绍与平衡/快速节奏开关。规则面板可按钮/遮罩/Esc 关闭。`claim_proven` / `influence_revealed` 触发克制亮牌与补牌提示；节奏倍率与 hold 时长走表现层 `deskPacing`（尊重 `prefers-reduced-motion`）。占位卡为深色暖金权谋风。未改领域/持久化/Agent 编排；座位模型名仍受 `PublicSeatView` 字段限制，暂显示控制器类型。
