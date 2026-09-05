## Agent skills

### Issue tracker

Issues and specs live as markdown under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

---

## 项目记忆（跨会话备忘）

新会话直接引用本节，无需重新摸索。规则类改动先对照 `.scratch/brass-birmingham/spec.md` 与规则书 `.scratch/brass-birmingham/research/brass-rules.txt`（brass）；splendor 以官方规则书为准（牌表交叉核对记录见 `docs/adr/0011`）。

### 本地开发与验证循环

- 改码后先 `npm run build`（全工作区），再起本地服务器：`COUP_BIND_MODE=host COUP_PORT=8787 COUP_OPEN_BROWSER=0 node apps/server/dist/main.js`（用后台任务方式，不要 shell `&`）。
- 服务器重启后浏览器必须硬导航（先 about:blank 再进目标 URL），否则拿到旧页面/旧 bundle。
- **跑 `npm test` 前必须停掉本地服务器**（startServer 测试要占 8787 端口）。测试套件全部用临时 DB，不会污染 `~/.coup/coup.sqlite`。
- 浏览器手动验证时 60 秒回合计时器会不断"自动代打"吃掉回合：开局前把限时设为不限时；或在页面上下文里用 fetch 直接 POST 决策——先 `GET /api/session` 拿 CSRF，`POST .../matches/current/decision` 带 `x-csrf-token` 头，遇 `version_mismatch` 就重取版本重试。
- 用 curl 打 API 探针的坑：无负载的请求不要带 `content-type: application/json`（Fastify 对空 JSON body 回 400）；`curl -d` 隐式 POST，打 PATCH 路由必须显式 `-X PATCH`；中文 payload 在 Git Bash 里可能被按 GBK 发出导致 400，探针用 ASCII 显示名。

### 机器人对局测试

- `.scratch/brass-birmingham/lobbybot.mjs`（已 gitignore，勿提交）：`BASE_URL=<url> node lobbybot.mjs <房间号> <每人手数>`，自动占 2/3/4 号座并按 建造→铺路→贷款→跳过 打牌；它自己维护 cookie jar（resume-seat 会轮换座位凭证）。
- 决策载荷形如 `{protocolVersion:1, requestId, stateVersion, command}`；轮询体在 `{view:{state,hand,decidingSeatId}}` 下；观战轮询用 `?spectate=1`（无需座位凭证）。
- `guest_cookies.json` 是座位凭证文件，严禁提交。

### 部署

- 服务器地址、密钥路径与完整命令见 `.scratch/deploy-notes.local.md`（gitignored，含敏感信息，勿提交）。
- 流程：`git archive HEAD` 打包 → scp 到服务器解压 → 服务器 `npm install`（仅当新增/改动 workspace 包或依赖时必须，普通版本可跳过）→ `npm run build` → `systemctl restart coup`。
- 坑：`.gitignore` 的 `data/` 曾误伤 `packages/*/src/data/`（brass 牌表长期未入库，线上靠旧残留文件侥幸构建）；已根锚定为 `/data/`（2026-09 修复，ADR-0011 有记）。
- 线上验证：`systemctl is-active coup`；curl 首页看引用的 bundle 名。bundle 哈希可能因 CRLF/LF 与本地不一致，**用内容标记**（在 bundle 里 grep 新功能文案）判断新旧，不要比对哈希相等。

### 迭代纪律（用户预期的工作方式）

- 每轮改动：本地浏览器实测 → `npm test` + `npm run typecheck` 全绿 → 中文提交信息（写清动机）→ 部署 → 线上复验 → 中文汇报。
- 测试规模基线：全仓 283 项（domain 23 / brass-domain 21 / splendor-domain 18 / server 115 / web-desk 32 / web 8 / server-local 62 / web-local 4），总数变化时更新 README。

### 公网安全与房间回收语义（2026-09 上线审计沉淀，决策记录见 `docs/adr/0012`）

- `GET /api(/<game>)/room-recovery` 需要会话（防房号枚举绕过限速门禁）；前端 `roomApi.fetchRecovery` 已先 `ensureSession` 再带 CSRF。
- `POST …/room-recovery/abandon` 拒绝 `restored`（活）房间（409 `restored_room_active`）——活房间交给空房回收或对局内处置，不能凭会话+房号杀局；failed/migration 条目仍可 abandon。
- 空房回收（`gameRoomStack.isRoomEmpty`）：大厅/续局/「对局阶段但内存无对局」一律按可回收，靠活跃度（任意 GET/POST 刷新 emptySince）续命；对局中要求「全部远程座位离席 + 本地座位 10 分钟未见」（`LOCAL_SEAT_GONE_MS`，由 GET/POST matches/current 以本地凭证刷新）。空置从「首次观察到」起算 30 分钟。测试断言存活要用 `/presence`（`GET /:code` 本身算活动）。
- 回席/心跳必须 `ensureTurnTimer` 补武装回合计时器（缺席暂停会拆计时器）；不能用 `armTurnTimer` 无条件重置 deadline（等于无限顺延）。回归：turnTimerApi.test「re-arms after resume」。
- 会话存储有上限（`MAX_SESSIONS=10000`，FIFO 驱逐）；brass/splendor 房号查询限速已开（与 coup 一致，10 次未命中/分钟 → 429）。
- 三端大厅轮询 404 会提示「房间已解散或已被回收」并退回首页（coup/brass/splendor App）。
- 客人主动让座：`POST …/rooms/:code/seats/leave`（平台栈端点，凭证即身份，仅大厅阶段、仅远程座位）；三端大厅自己的座位卡上有「让出座位」按钮。
- 座位凭证 Cookie 已持久化（`SEAT_COOKIE_MAX_AGE_SEC` 30 天， issuance 点统一带 Max-Age）：浏览器重启后仍可回席；会话 Cookie 仍为会话级（无状态，丢失自动重建）。

### 平台层（ADR-0010，2026-09 落地）

- **改游戏规则**去 `packages/domain` / `packages/brass-domain` / `packages/splendor-domain`；**改联机编排**去 `apps/server/src/platform/gameRoomStack.ts`（一款实现，两游戏共用）；两者之间只经 `platform/gameModule.ts` 的 `GameModule` 接缝，不要在栈里写游戏语义。新游戏接入清单：`docs/platform/adding-a-game.md`；splendor 接入记录：`docs/adr/0011`。
- 新游戏接入清单：`docs/platform/adding-a-game.md`。核心步骤 = GameModule 适配器（约 200 行，参考 `apps/server/src/brass/brassModule.ts`）+ createApp 一行挂载 + 前端 `createRoomClient(prefix)` 薄壳 + API 集成测试（参考 `brassRoomApi.test.ts`）。
- 前端传输统一走 `apps/web/src/platform/roomApi.ts`；`lanRoom.ts`/`brassApi.ts` 只留文案映射与类型。被 node `--experimental-strip-types` 测试链路引用的文件，import 说明符要用 `.ts` 后缀（vite/tsc 均兼容）。
- coup 旧路径 `/api/rooms…`、`/api/room-recovery` 原样保留（响应多了 `game` 字段，向后兼容）；brass 走 `/api/brass/rooms…`，恢复清单键是 `items`（coup 是 `rooms`），由 `GameModule.recoveryListKey` 区分。

### 已知事实与坑

- 入口路由：`/` 门户、`/brass` 伯明翰、`/splendor` 璀璨宝石、`/coup` 与 `/join` 政变（`apps/web/src/main.tsx` 的 `route()`）。
- 本地 Brass/ splendor 房间上限各 10 个；满了用 node:sqlite 清库：`DELETE FROM brass_runs; DELETE FROM brass_rooms;`（splendor 对应 `splendor_runs`/`splendor_rooms`；注意：清库会毁掉进行中的本地对局）。无人问津的房间自 2026-09 起会在约 30 分钟后自动回收（ADR-0012），等一等也能腾出名额。
- Brass 持久化为逐命令提交（`brassStore.commitCommand`）；**旧 brassRoutes 曾漏传 persistence 导致决策不落库、重启回滚**（2026-09 随平台化修复，brassRoomApi.test 锁定回归）——新游戏适配器务必在 `submitDecision` 里接 `options.store`。
- 前端 spectator 标记在回席/建房/就座时必须复位（`BrassApp`），否则前观战者回到对局看不到手牌。
- Brass 续局 join/leave 按座位凭证路由（`/rematch/join` 无 seatId 段，与 coup 一致）；旧实现路径不一致导致线上续局无法确认，已修并有回归测试。
- Brass 以玩家序号映射座位（前端硬编码 seatId=序号+1），非连续占座开局会被 `seats_not_contiguous` 拒绝——这是刻意行为，不是 bug。
- 引擎规则疑似有误时，先查 spec/规则书再改——曾发生过引擎静默漏实现"每行动弃一张手牌"这类偏差（2026-09 已修，附回归测试）。
- 未解事项（低优先）：曾出现本地对局重启后回滚到早期版本的事故；持久层代码审计无果（证据被清库销毁）。若复现，第一时间保留 SQLite 文件与恢复日志。2026-09 发现并修复了 brass 栈同类缺陷（决策不落库），若 coup 线上再现同症状，优先查 `coupModule.submitDecision` 的 persistence 链路。
- tsc 严格模式坑：React 19 下类型用 `ReactElement`（不是 `JSX.Element`）；style 里的自定义 CSS 变量要 `as CSSProperties`。
- 日志面板自动滚动按末条 `seq` 而非数组长度（log 截断到 60 条后长度不再变化）。
