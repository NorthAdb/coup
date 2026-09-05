# 新游戏接入指南（GameModule）

> 目标：加一款新桌游（如 Splendor、Love Letter）时，**不重写任何联机编排**。
> 房间、占座、大厅门禁、心跳离席、回合计时与超时代打、增量轮询、观战、续局、
> 重启恢复、空房回收、持久化接缝，全部由平台栈提供（ADR-0010）。

## 架构总览

```
Board Game Platform
│
├── Platform Core（apps/server/src/platform/ + apps/web/src/platform/）
│   ├── 会话 / CSRF / Origin 白名单（createApp 应用外壳）
│   ├── 房间 · 座位 · Lobby 门禁（roomRegistry + lobbyStart，平台栈装配）
│   ├── 心跳离席状态机（seatPresenceTracker / seatAbsence）
│   ├── 回合计时 · 超时代打 · 增量轮询 · 观战 · 续局 · 重启恢复（gameRoomStack）
│   ├── 持久化接缝（GameMatchStore / GameRoomPersistence，各游戏自己的 SQLite 表）
│   └── 前端传输（roomApi.ts：会话引导 + createRoomClient(prefix) 端点工厂）
│
├── Game Module（每款游戏一个适配器，唯一接缝 platform/gameModule.ts）
│   ├── startMatch / matchFromRun      —— 怎么开局、怎么从持久层复原
│   ├── seatFacts / activeDecidingSeatId —— 座位事实（本地/远程/淘汰）与谁欠决策
│   ├── submitDecision                  —— 命令校验与应用（决策模型不统一，payload 透传）
│   ├── planAutoDecision                —— 超时代打计划
│   ├── seatView / spectatorView        —— 座位视角与观战投影
│   ├── beforeStart / hostForceEliminate —— 可选：开局预处理 / 强制淘汰处置
│   └── invitePayload + 元数据          —— 邀请载荷、座位数、房间上限、路由前缀
│
└── Games
    ├── Coup   packages/domain（引擎） + apps/server/src/games/coupModule.ts + web-desk UI
    ├── Brass  packages/brass-domain（引擎） + apps/server/src/brass/brassModule.ts + apps/web/src/brass/ UI
    └── <你的新游戏> …
```

## 接入清单

1. **规则引擎**：新建 `packages/<game>-domain`（纯函数、无 IO，参考 `@coup/brass-domain`）。
   至少提供：`createMatch`（开局）、`applyCommand`（原子校验与应用，返回新状态+事件）、
   `projectForSeat`（按座位投影，隐藏私有态）。对局状态需含 `matchId`、`stateVersion`、`status`。

2. **持久化**：仿 `brassStore.ts` 建两张表（`<game>_rooms` / `<game>_runs`，
   房间 blob + 对局快照），实现 `GameMatchStore` / `GameRoomPersistence` 接缝
   （createRun / commitCommand / getRun / technicalAbort / userAbort / saveRoom / clearRoom / loadRooms）。

3. **游戏模块适配器**：写 `<game>Module.ts`（参考 `apps/server/src/brass/brassModule.ts`，约 200 行）：
   - 元数据：`id`（URL 段）、`apiPrefix`（如 `"splendor"` → `/api/splendor/rooms…`）、
     `seatCount`、`maxRooms`、`createRequiresLanHost`（云上通常 `false`）、
     `throttleRoomLookup`、`recoveryListKey`。
   - 生命周期：`newMatchId` / `startMatch` / `matchFromRun`。
   - 规则语义：`seatFacts` / `activeDecidingSeatId` / `planAutoDecision` /
     `submitDecision`（校验失败返回 `{ok:false, reason}`；持久化故障**抛错**，
     平台栈会折算 `technical_abort` + 502）/ `seatView` / `spectatorView`。
   - 可选钩子：`beforeStart`（自动关空位、占座约束）、`hostForceEliminate`（仅淘汰类游戏）。

4. **挂载**：`createApp.ts` 加一次 `createGameRoomStack(app, { module, store, roomPersistence, … })`。

5. **前端**：
   - `apps/web/src/main.tsx` 路由加 `<game>` 入口；门户 `portal/Portal.tsx` 加卡片。
   - 新建 `src/<game>/<game>Api.ts`：`createRoomClient("<game>")` + 游戏 view 类型 +
     中文文案映射（参考 `brassApi.ts`，全部导出函数 < 150 行）。
   - 对局桌面 UI（自由发挥，视觉刻意不统一）；轮询决策直接用
     `client.fetchMatch` / `client.submitDecision`，增量轮询协议（`since`/`spectate`/
     `absences`/`turnDeadline`/`autoDecision`）与 coup/brass 完全一致。

6. **测试**：仿 `apps/server/src/brassRoomApi.test.ts` 写 API 集成测试
   （建房→占座→开局→决策→重启恢复），接入 `apps/server/package.json` 的 test 清单；
   引擎单测/模糊测试放 `packages/<game>-domain`。

7. **文档**：`README.md` 游戏栏目 + 仓库结构表 + 测试计数；ADR 记录规则相关决策。

## 决策模型注意事项（来自 coup/brass 的经验）

- **命令尽量原子**：一次提交整行动作的全部参数（brass 模式），引擎校验拒绝或应用。
  拆成多步决策会让服务端状态机与回合计时复杂化数倍（ADR-0009 决策 2）。
- **投影必须裁剪私有态**：`spectatorView` 与他人视角绝不能泄露手牌/暗牌。
- **状态版本号**：每次成功命令 `stateVersion` 必须递增，增量轮询依赖它。
- **超时代打**：`planAutoDecision` 必须返回「破坏最小」的合法命令（coup→放弃/收入；
  brass→跳过/拆板），且与人类决策走同一 `submitDecision` 通路。
- **座位与玩家序号**：若前端按「座位号 = 玩家序号+1」渲染（brass 即如此），
  必须在 `beforeStart` 校验有效座位连续，否则会错位绑定。
