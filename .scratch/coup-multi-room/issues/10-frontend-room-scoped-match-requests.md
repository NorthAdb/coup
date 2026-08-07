# 10 — 前端对局请求房间化

**What to build:** 前端对局轮询与决策请求携带当前房间号；双浏览器分处两房时各自对局独立、互不干扰。

**Blocked by:** 09 per-room 对局运行时与房间作用域对局 API（服务端）

**Status:** done

- [ ] 全部对局请求携带当前房间号；无房号时不发对局请求或明确报错
- [ ] 双浏览器分别处于两房时，各自轮询/决策/终局正确，互不串房
- [ ] 单房体验回归不变：建房、加入、对局、续局等待

## Comments

- 已完成：前端七处对局请求均携带当前房间号；新增房间路径 helper，并在缺少房号时于发请求前明确报错。
- 测试：`npm test -w @coup/web`、`npm test -w @coup/server`、根目录 `npm test` 全部通过；`npm run typecheck -w @coup/web` 与根目录 `npm run typecheck` 全部通过。
- Commit：`ea3c356`（`Scope frontend match requests by room`）。
