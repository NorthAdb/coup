## Agent skills

### Issue tracker

Issues and specs live as markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

---

## 项目记忆（跨会话备忘）

新会话直接引用本节，无需重新摸索。规则类改动先对照 `.scratch/brass-birmingham/spec.md` 与规则书 `.scratch/brass-birmingham/research/brass-rules.txt`。

### 本地开发与验证循环

- 改码后先 `npm run build`（全工作区），再起本地服务器：`COUP_BIND_MODE=host COUP_PORT=8787 COUP_OPEN_BROWSER=0 node apps/server/dist/main.js`（用后台任务方式，不要 shell `&`）。
- 服务器重启后浏览器必须硬导航（先 about:blank 再进目标 URL），否则拿到旧页面/旧 bundle。
- **跑 `npm test` 前必须停掉本地服务器**（startServer 测试要占 8787 端口）。测试套件全部用临时 DB，不会污染 `~/.coup/coup.sqlite`。
- 本地 Brass 房间上限 10 个；满了用 node:sqlite 清库：`DELETE FROM brass_runs; DELETE FROM brass_rooms;`（注意：清库会毁掉进行中的本地对局）。
- 浏览器手动验证时 60 秒回合计时器会不断"自动代打"吃掉回合：开局前把限时设为不限时；或在页面上下文里用 fetch 直接 POST 决策——先 `GET /api/session` 拿 CSRF，`POST .../matches/current/decision` 带 `x-csrf-token` 头，遇 `version_mismatch` 就重取版本重试。

### 机器人对局测试

- `.scratch/brass-birmingham/lobbybot.mjs`（已 gitignore，勿提交）：`BASE_URL=<url> node lobbybot.mjs <房间号> <每人手数>`，自动占 2/3/4 号座并按 建造→铺路→贷款→跳过 打牌；它自己维护 cookie jar（resume-seat 会轮换座位凭证）。
- 决策载荷形如 `{protocolVersion:1, requestId, stateVersion, command}`；轮询体在 `{view:{state,hand,decidingSeatId}}` 下；观战轮询用 `?spectate=1`（无需座位凭证）。
- `guest_cookies.json` 是座位凭证文件，严禁提交。

### 部署

- 服务器地址、密钥路径与完整命令见 `.scratch/deploy-notes.local.md`（gitignored，含敏感信息，勿提交）。
- 流程：`git archive HEAD` 打包 → scp 到服务器解压 → 服务器 `npm run build` → `systemctl restart coup`。
- 线上验证：`systemctl is-active coup`；curl 首页看引用的 bundle 名。bundle 哈希可能因 CRLF/LF 与本地不一致，**用内容标记**（在 bundle 里 grep 新功能文案）判断新旧，不要比对哈希相等。

### 迭代纪律（用户预期的工作方式）

- 每轮改动：本地浏览器实测 → `npm test` + `npm run typecheck` 全绿 → 中文提交信息（写清动机）→ 部署 → 线上复验 → 中文汇报。
- 测试规模基线：全仓 241 项（domain 23 / brass-domain 21 / server 91 / web-desk 32 / web 8 / server-local 62 / web-local 4），总数变化时更新 README。

### 已知事实与坑

- 入口路由：`/` 门户、`/brass` 伯明翰、`/coup` 与 `/join` 政变（`apps/web/src/main.tsx` 的 `route()`）。
- Brass 持久化为逐命令提交（`brassStore.commitCommand`）；前端 spectator 标记在回席/建房/就座时必须复位（`BrassApp`），否则前观战者回到对局看不到手牌。
- 引擎规则疑似有误时，先查 spec/规则书再改——曾发生过引擎静默漏实现"每行动弃一张手牌"这类偏差（2026-09 已修，附回归测试）。
- 未解事项（低优先）：曾出现本地对局重启后回滚到早期版本的事故；持久层代码审计无果（证据被清库销毁）。若复现，第一时间保留 SQLite 文件与恢复日志。
- tsc 严格模式坑：React 19 下类型用 `ReactElement`（不是 `JSX.Element`）；style 里的自定义 CSS 变量要 `as CSSProperties`。
- 日志面板自动滚动按末条 `seq` 而非数组长度（log 截断到 60 条后长度不再变化）。
