# 13 — 人对 Stub Agent 打出收入

**What to build:** 固定 2 座开一局：本地玩家可声明「收入」，另一座由始终给出合法决策的 Stub Agent 自动行动；页面上能看到钱币变化与对局事件。领域核心对开局与收入有自动化测试。

**Blocked by:** 12 — 本地启动壳

**Status:** resolved

- [x] 可创建进行中的对局（2 座：本地人类 + Stub）
- [x] 本地玩家声明收入后钱币 +1，回合推进
- [x] Stub 座位能自动提交合法座位决策
- [x] 浏览器显示公开钱币与事件反馈
- [x] 领域核心对创建对局与收入命令有确定性测试

## Answer

已打通 2 座（本地人类 + Stub）收入垂直切片：`packages/domain` 提供确定性 `createMatch` / `applyCommand(income)` / `projectForSeat`；服务端内存对局 + Stub 自动取 `legalDecisions[0]`；网页可开局、看公开钱币与事件、声明收入。领域与 Stub 编排有自动化测试。
