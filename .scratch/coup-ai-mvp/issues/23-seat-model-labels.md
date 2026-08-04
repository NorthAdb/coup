# 23 — 座位卡公开模型标签

**What to build:** 对局左侧座位卡显示各 Agent 座位的 CLI 与模型可读标签（例如 `OpenCode · glm-5.2`）；本地人类座位仍显示人类身份。模型信息来自公开座位投影，开局配置一旦入局即可在桌上分辨对手实际在跑什么。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] `PublicSeatView`（或等价公开座位投影）携带该座位的 CLI 与模型标识；人类座位无模型
- [x] 对局座位卡以可读标签展示上述信息，不以 raw 路径为主文案
- [x] Stub / 占位模型有可理解的展示，不空白误导
- [x] 领域事件、隐藏牌与私有状态边界不变；模型选择仍是公开开局配置

## Answer

`PublicSeatView` 增加公开 `cli` / `modelId`（人类座位为 `null`）；`toSeatView` 从 `seatAgents` 投影。座位卡用 `seatModelLabel` 显示可读标签（如 `OpenCode · gpt-test`、`Stub · 占位`、`本地人类`）。
