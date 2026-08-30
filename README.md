# Midland Works · 线上桌游工坊

一个跑在云服务器上的多游戏联机平台，React + Fastify + SQLite，单进程全栈。现收录两款桌游：

## 《工业革命：伯明翰》Brass: Birmingham（2026-08 新增）

2–4 人经济策略桌游的网页联机版：

- **完整规则引擎** `packages/brass-domain`（纯函数、无 IO）：6 产业 45 块瓦片/人、22 个可建地点（含 2 农场酒厂）、39 条运河/铁路连线、5 商人位 9 板、煤/铁市场与收入轨、Build/Network/Develop/Sell/Loan/Scout/Pass 七种行动全量校验（煤最近优先、双轨啤酒、覆盖规则、商人啤酒奖励、时代切换与两段计分）。
- **规则数据三源交叉验证**：官方规则书 PDF、ikegami/tts_brass（官方扫描 TTS 脚本）、npow/BrassBirmingham，逐表核对（详见 `.scratch/brass-birmingham/spec.md`，冲突裁决记录在案）。
- **平行房间栈** `apps/server/src/brass/`：`/api/brass/rooms/*` 全套路由，复用 coup 的会话/CSRF 守卫、心跳离席状态机与 4 位房间码（跨游戏共享码池，`docs/adr/0009`）；独立 SQLite 表（`brass_rooms`/`brass_runs`），支持重启恢复、观战、增量轮询与超时代打（Pass）。
- **独立视觉**：入口 `/brass`，工业时代黄铜/羊皮纸主题，SVG 版图（实体版图地理精调坐标、石板建造地块、产业瓦片正反面外观、运河/铁路双线型、纸纹暗角）+ 局内动效（落子弹入、翻面闪烁、可铺连线蚂蚁线、可建地点呼吸辉光、日志滑入；尊重 prefers-reduced-motion）+ 行动向导（自动推导合法目标与资源来源）、市场格价条与当前买/卖价、竖版手牌卡（标注可建产业）、中文日志。门户首页 `/` 选择游戏。
- **质量**：19 项规则单测 + 多种子随机完整对局模糊测试（2/3/4 人开局到终局，VP 分布接近真实对局）。

## 《政变》Coup

一个跑在云服务器上的《政变》（Coup）多人卡牌对战游戏：互联网联机房间 + 本机 Agent 单机对战双形态，React + Fastify + SQLite，单进程全栈。

## 双形态

| 形态 | 目录 | 说明 |
|---|---|---|
| **联机版** | `apps/web` + `apps/server` | 互联网多人对局：创建/加入房间（4 位房间号）、2–6 名真人同台、占座/回席/离席/主机重启恢复、终局同房续局（全员确认后开新局）。部署到云服务器。 |
| **本机版** | `apps/web-local` + `apps/server-local` | 本机人类 + 本机 Agent（OpenCode / Claude Code / Stub）对弈，仅 loopback，无任何房间代码。 |
| **共享层** | `packages/domain`（规则引擎）、`packages/protocol`（协议类型）、`packages/web-desk`（策划桌 UI） | 与"联机还是单机"无关的纯共享代码。 |

两块应用**代码零纠缠**：联机版无 Agent 痕迹，本机版无房间痕迹（见 `docs/adr/0005`）。

## 快速开始

要求 Node.js ≥ 22。

```bash
npm install

# 联机版（构建全部工作区）
npm run build
npm run start        # 联机版：构建 web 后启动 server（默认 8787）

# 本机版（仅本机使用）
npm run start:local  # 本机版：Agent 对战，loopback 随机端口并自动打开浏览器
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

## 玩法与机制

- 经典《政变》规则：5 种角色（公爵/刺客/队长/大使/伯爵夫人）、收入/外援/征税/刺杀/偷窃/交换/政变、质疑与阻挡。
- 多房制：服务器最多并行 20 个房间，每房独立对局、互不干扰；4 位房间号 + 按 IP 限速防穷举（弱门禁，非账号体系）；空房（大厅无客人 / 进行中全员离席）30 分钟闲置回收并释放房号，另有 5 分钟兜底清扫。
- 回合限时：房主在大厅设置（不限时/30/60/90/120 秒，默认 60）；超时由服务器代为稳妥决策（响应→放弃、行动→收入、揭示/交换→按合法选项），缺席暂停顺延，重启后重排。
- 观战：对局进行中，无座位的访客可只读观战（私有态剥离，`?spectate=1`）。
- 增量轮询：客户端按 `stateVersion` 增量拉取，状态未变仅回轻量载荷，长对局多房间不再全量重放历史。
- 离席：15s 重连宽限 → 离席 + 5min 软超时，主机可继续等待/技术中止/强制揭示淘汰。
- 同房续局：终局后主机「续局等待」，客人弹窗选择加入（保留座位、轮换凭证）或离开（座位转开放），全员确认（或座位被处理）后开新局。
- 主机重启恢复：服务器重启后按房间逐房恢复（大厅/续局等待/进行中对局），恢复失败房可单独放弃。
- 表现层：五角色 SVG 卡面与统一牌背、绒面牌桌、WebAudio 合成音效（可在桌面右上角开关）、回合计时环、胜利加冕横幅、快捷人数预设大厅。
- 完整规格：`.scratch/coup-internet-multiplayer/spec.md` 与 `.scratch/coup-multi-room/spec.md`；术语表：`CONTEXT.md`；决策记录：`docs/adr/`（回合计时器与观战见 ADR-0008）。

## 测试

```bash
npm test        # 全部工作区测试（185 项）
npm run typecheck
```

规则内核（`packages/domain`）与对局编排（含续局确认流程）有较完整的单测与 API 级集成测试。

## 技术栈

- **前端**：React 19 + Vite + TypeScript
- **后端**：Fastify 5 + Node 内置 `node:sqlite`
- **语言/结构**：TypeScript monorepo（npm workspaces），ESM
