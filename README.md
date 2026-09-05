# Midland Works · 线上桌游工坊

一个跑在云服务器上的多游戏联机平台：React 19 + Fastify 5 + SQLite，TypeScript monorepo，单进程全栈。现收录两款桌游，共用一套平台核心（ADR-0010）——与账号无关的联机基础设施：4 位房间号门禁（按 IP 限速）、心跳离席状态机、只读观战、增量轮询、回合限时与超时代打、服务器重启逐房恢复；新游戏按 `GameModule` 接缝接入，不再从头搭房间栈（见 `docs/platform/adding-a-game.md`）。

门户首页 `/` 选择游戏，各游戏入口独立、视觉独立、规则引擎独立。

---

## 《政变》Coup（首发）

2–6 人的经典 bluffing 卡牌对战。

**玩法**：5 种角色（公爵/刺客/队长/大使/伯爵夫人）、收入/外援/征税/刺杀/偷窃/交换/政变，质疑与阻挡贯穿全程。

**联机特性**：

- 多房制：最多并行 20 个房间，每房独立对局；空房闲置 30 分钟回收房号，另有 5 分钟兜底清扫。
- 回合限时：房主在大厅设置（不限时/30/60/90/120 秒，默认 60）；超时由服务器代为稳妥决策（响应→放弃、行动→收入、揭示/交换→按合法选项），缺席暂停顺延，重启后重排。
- 观战：进行中的对局可被无座位访客只读观战（私有态剥离，`?spectate=1`）。
- 离席：15 秒重连宽限 → 离席 + 5 分钟软超时，房主可继续等待/技术中止/强制揭示淘汰。
- 同房续局：终局后房主发起「续局等待」，客人选择加入（保留座位、轮换凭证）或离开，全员确认后开新局。
- 主机重启恢复：按房间逐房恢复（大厅/续局等待/进行中对局），恢复失败的房间可单独放弃。
- 增量轮询：客户端按 `stateVersion` 拉取增量，状态未变仅回轻量载荷。
- 表现层：五角色 SVG 卡面与统一牌背、绒面牌桌、WebAudio 合成音效（可开关）、回合计时环、胜利加冕横幅、快捷人数预设大厅。

双形态：联机版（`apps/web` + `apps/server`）与**本机版**（`apps/web-local` + `apps/server-local`，本机人类 + 本机 Agent 对弈，仅 loopback，无房间概念）——两块应用代码零纠缠（`docs/adr/0005`）。

完整规格：`.scratch/coup-internet-multiplayer/spec.md`、`.scratch/coup-multi-room/spec.md`；术语表 `CONTEXT.md`。

---

## 《工业革命：伯明翰》Brass: Birmingham

2–4 人经济策略桌游的网页联机版，入口 `/brass`。

**规则引擎** `packages/brass-domain`（纯函数、无 IO）：6 产业 45 块瓦片/人、22 个可建地点（含 2 农场酒厂）、39 条运河/铁路连线、5 商人位 9 板、煤/铁市场与收入轨；Build/Network/Develop/Sell/Loan/Scout/Pass 七种行动全量校验——每行动弃 1 张手牌（Wild 回抽牌区）、煤最近距离优先、铁路双轨耗啤酒、覆盖建造（同产业更高级/资源清空才能覆盖对手）、商人啤酒奖励（Gloucester 免费研发等四类）、收入缺额拆板与 VP 扣减、时代切换与两段计分。

规则数据经**三源交叉验证**：官方规则书 PDF、ikegami/tts_brass（官方扫描 TTS 脚本）、npow/BrassBirmingham，逐表核对（详见 `.scratch/brass-birmingham/spec.md`，冲突裁决记录在案）。

**接入方式**：`apps/server/src/brass/brassModule.ts` 是一个 `GameModule` 适配器，挂载在平台通用房间栈上（ADR-0010）；`/api/brass/rooms/*` 与 coup 共用同一份编排实现，复用会话/CSRF 守卫、心跳离席状态机与跨游戏共享的 4 位房间码池（`docs/adr/0009`）；独立 SQLite 表（`brass_rooms`/`brass_runs`），支持重启恢复、观战、增量轮询与超时代打。

**视觉与交互**（黄铜/羊皮纸主题）：

- SVG 版图：实体版图地理精调坐标、浅色纸面地块 + 墨印地名、每城一座剪影（Stoke 瓶窑/Dudley 城堡/Coalbrookdale 高炉/Coventry 双塔教堂等九类原型）、产业瓦片正反面外观（含拥有者色环与角标）、产业徽标、运河水系/铁路枕木、煤立方/铁锭/啤酒桶立体 token、罗盘与铭牌、纸纹暗角。
- 局内动效：落子弹入、翻面闪烁、可铺连线蚂蚁线、可建地点呼吸辉光、日志滑入（尊重 prefers-reduced-motion）。
- 行动向导：自动推导合法目标与资源来源；建造/铺路幽灵预览（含覆盖落位）；覆盖建造目标选择；卖货模式高亮可卖地点、商人啤酒自动取用并带 Gloucester 免费研发目标选择；缺额拆板面板；市场格价条与当前买/卖价；竖版手牌卡（类型色带 + 产业色字块）；玩家面板数据格子；中文日志（玩家色点）。

质量：21 项规则单测 + 多种子随机完整对局模糊测试（2/3/4 人开局到终局）。

---

## 仓库结构

| 路径 | 内容 |
|---|---|
| `apps/web` + `apps/server` | 联机版前端与后端（两款游戏共用门户、会话、房间基础设施） |
| `apps/server/src/platform/` | **平台核心**：`GameModule` 接缝 + 通用房间/对局栈（ADR-0010），新游戏零重写接入 |
| `apps/server/src/games/` · `apps/server/src/brass/` | 各游戏的平台适配器（GameModule 实现，约 200 行/款） |
| `apps/web/src/platform/` | **前端平台核心**：会话/CSRF 传输 + `createRoomClient(prefix)` 房间端点工厂 |
| `apps/web-local` + `apps/server-local` | 《政变》本机版（人类 vs 本机 Agent，仅 loopback） |
| `packages/domain` / `packages/protocol` / `packages/web-desk` | 《政变》共享层：规则引擎、协议类型、策划桌 UI |
| `packages/brass-domain` | 《伯明翰》纯函数规则引擎（无 IO，可直接单测/模糊测试） |
| `docs/adr/` | 决策记录（0001–0010） |
| `docs/platform/adding-a-game.md` | 新游戏接入指南（GameModule 清单） |
| `.scratch/<feature>/spec.md` | 各特性完整规格（issue tracker 用法见 `docs/agents/issue-tracker.md`） |

## 快速开始

要求 Node.js ≥ 22。

```bash
npm install

# 联机版（构建全部工作区）
npm run build
npm run start        # 构建 web 后启动 server（默认 8787）；门户 / ，政变 /coup ，伯明翰 /brass

# 本机版（仅本机使用）
npm run start:local  # 政变 Agent 对战，loopback 随机端口并自动打开浏览器
```

## 部署（云服务器）

1. 上传源码到服务器，`npm ci && npm run build`。
2. 用 systemd 或 PM2 运行 `node apps/server/dist/main.js`。
3. 环境变量：

| 变量 | 说明 |
|---|---|
| `COUP_BIND_MODE=host` | 监听 `0.0.0.0`（默认 8787，可用 `COUP_PORT` 改） |
| `COUP_PUBLIC_HOST` | 展示/加入链接用的公网主机名 |
| `COUP_ALLOWED_ORIGINS` | 放行的 Origin 白名单（逗号分隔），如 `https://coupgame.xyz,http://47.93.119.89:8787` |
| `COUP_OPEN_BROWSER=0` | 无桌面服务器关闭自动开浏览器 |
| `COUP_TRUST_PROXY=1` | 位于 Nginx 等反代之后时开启（房间号限速按真实客户端 IP 计） |
| `COUP_DB_PATH` | SQLite 路径（默认 `~/.coup/coup.sqlite`） |

推荐架构：**Nginx 反代 → 127.0.0.1:8788 → node**。用户访问 80/443（或 8787 兼容旧链接），node 不暴露公网；`/assets/` 静态资源可在 Nginx 层永久缓存。

> 国内大陆服务器绑定域名需完成 ICP 备案；未备案前可直连 `http://<公网IP>:8787`。

## 测试

```bash
npm test        # 全部工作区测试（248 项：domain 23 / brass-domain 21 / server 98 / web-desk 32 / web 8 / server-local 62 / web-local 4）
npm run typecheck
```

两款游戏的规则内核与对局编排（含续局确认、离席、增量轮询、观战投影等 API 级集成测试）有较完整的测试覆盖；`packages/brass-domain` 另有多种子随机完整对局模糊测试。

## 技术栈

- **前端**：React 19 + Vite + TypeScript
- **后端**：Fastify 5 + Node 内置 `node:sqlite`
- **语言/结构**：TypeScript monorepo（npm workspaces），ESM
