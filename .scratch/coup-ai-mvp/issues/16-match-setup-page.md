# 16 — 开局配置页

**What to build:** 开局前可选 2–6 人、看到固定本地玩家座位与自动生成的 Agent 显示名，并记住上次人数与座位选择；确认后进入对局（Agent 仍可为 Stub）。

**Blocked by:** 13 — 人对 Stub Agent 打出收入

**Status:** resolved

- [x] 可选总人数 2–6，座位 1 固定为本地玩家
- [x] 其余座位有自动显示名且顺序明确
- [x] 上次配置被记住并预填
- [x] 开始后进入可玩对局
- [x] 页面标明本机自用边界（可先占位文案）

## Answer

落地开局配置页与 `POST /api/matches` 配置体：2–6 座、座位 1 固定本地人类、Agent 显示名（灰狐/白塔…）按顺时针生成；每座 CLI/模型为占位选择并写入 `localStorage`（真探测归票 19，SQLite 归票 20）；Agent 仍以 Stub 开局可玩。服务端 `parseMatchSetup` + `startMatch` 校验首座人类与座位数；对局桌「返回开局」回到配置页并预填上次选择。
