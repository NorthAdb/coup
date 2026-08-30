# ADR-0009：Brass: Birmingham 接入与平行房间栈

日期：2026-08-30 ｜ 状态：已接受

## 背景

仓库现有 Coup 联机版（domain/protocol/web-desk/web/server）无游戏类型抽象：`MatchState`、`DomainCommand`、`matchRuntime.decisionToCommand`、`autoDecision`、大厅门禁等均为 coup 语义硬编码。现需新增第二款桌游《Brass: Birmingham》（2–4 人，规则复杂度远高于 coup：原子动作带多资源来源选择、两时代、时代末计分）。

## 决策

1. **规则引擎独立新包 `@coup/brass-domain`**，纯函数、无 IO，与 coup 的 `@coup/domain` 平行；不抽公共 `GameModule` 接口强迫 coup 迁移。理由：两游戏决策模型差异过大（coup=单步决策流；brass=原子复合命令），强行统一接口会污染双方；等第三款游戏出现再抽象。
2. **命令模型用原子复合命令**：一次提交整行动作全部参数（含资源来源选择），引擎原子校验拒绝或应用。UI 可行项由引擎导出的 helper（legalBuildTargets 等）枚举。理由：brass 行动是连续不可逆序列（取煤→翻面→收入），拆成多步决策会让 server 状态机与回合计时复杂化数倍；原子校验天然支持乐观并发与重放。
3. **服务端平行栈** `apps/server/src/brass/`：独立路由 `/api/brass/rooms/...`、独立 RoomRegistry 与 sqlite 表（brass_rooms/brass_matches，blob 快照复用 coup 模式），复用共享基建（sessionAuth、房间码池、心跳/离席状态机、空闲清扫、增量轮询语义）。理由：coup 在产、有真实用户数据，零回归风险优先；房间层共享代码以 import 复用而非合并重写，等两游戏稳定后再考虑收编。
4. **前端路由**：`/` 重新设计为双游戏门户；`/coup/*` 承接现有屏幕（旧 `/join?code=` 301 兼容）；`/brass/*` 新桌面。brass 用独立样式文件与视觉主题（维多利亚工业风），刻意不与 coup 风格统一。
5. **商人啤酒奖励（Gloucester 免费 Develop）** 在 Sell 命令中预声明目标产业并在应用时校验，保持命令原子性。
6. **超时代打 = Pass**（弃手牌第一张）：对局面破坏最小。

## 后果

- coup 代码零改动；`apps/web` 的 App.tsx 改造为路径路由分发（唯一触碰 coup 前端之处，旧路径保持可用）。
- 房间码池共享（allocateRoomCode 注入占用集），两游戏房间码不冲突。
- 若未来要统一：brass-domain 的 state/command/projection 形状即是抽象的候选蓝本。
- 商人板块构成、逐卡明细以 .scratch/brass-birmingham/spec.md §冲突记录 为准（三源交叉验证）。
