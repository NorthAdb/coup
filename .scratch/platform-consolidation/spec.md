# 平台化收敛：GameModule 抽象与房间栈统一

状态：已完成（2026-09-05）

## 动机

平台已收录政变与伯明翰两款游戏，第三款（Splendor / Love Letter 等候选）在即。
ADR-0009 预留的「第三款游戏出现前不抽象」条件已满足：coup 内联路由（约 1700 行）
与 brass 平行栈（约 900 行）近乎逐行克隆，且克隆已产生两个无测试覆盖的线上级缺陷
（brass 决策不落库、续局路由断裂）。目标：新增游戏只需写规则与适配器，不重写联机编排。

## 交付物

- `apps/server/src/platform/gameModule.ts` —— GameModule 接缝（唯一抽象点）
- `apps/server/src/platform/gameRoomStack.ts` —— 通用房间/对局栈（路由/计时/恢复/续局/回收）
- `apps/server/src/games/coupModule.ts`、`apps/server/src/brass/brassModule.ts` —— 两游戏适配器
- `apps/web/src/platform/roomApi.ts` —— 前端共享传输 + createRoomClient(prefix)
- 删除 `apps/server/src/brass/brassRoutes.ts`；createApp 瘦身为应用外壳
- 新增 `apps/server/src/brassRoomApi.test.ts`（7 项，含两个缺陷回归）
- `docs/adr/0010-平台层游戏模块抽象与房间栈统一.md`、`docs/platform/adding-a-game.md`

## 验收

- 全仓 248 项测试绿（coup 91 项集成测试零改动跑在通用栈上，仅恢复清单新增 game 字段一处断言更新）
- 本地浏览器实测：门户 / brass 建房→占座→开局→UI 贷款→客人 API 跳过 / coup 建房→开局→UI 收入，全链路通过
- brass 决策逐命令落库（重启恢复回归测试锁定）；续局按座位凭证路由

## 刻意不统一之处

- 两游戏决策模型保持私有（coup 单步决策流 vs brass 原子复合命令），平台按不透明 payload 透传
- 视觉层不合并（ADR-0009 决策 4 维持）
- 本机版（server-local / web-local）零纠缠
