# 《政变》Coup

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
- 多房制：服务器最多并行 10 个房间，每房独立对局、互不干扰；4 位房间号 + 按 IP 限速防穷举（弱门禁，非账号体系）；空房（大厅无客人 / 进行中全员离席）30 分钟闲置回收并释放房号。
- 离席：15s 重连宽限 → 离席 + 5min 软超时，主机可继续等待/技术中止/强制揭示淘汰。
- 同房续局：终局后主机「继续对局」进入续局等待，客人弹窗选择加入（保留座位、轮换凭证）或离开（座位转开放），全员确认（或座位被处理）后开新局。
- 主机重启恢复：服务器重启后按房间逐房恢复（大厅/续局等待/进行中对局），恢复失败房可单独放弃。
- 完整规格：`.scratch/coup-internet-multiplayer/spec.md` 与 `.scratch/coup-multi-room/spec.md`；术语表：`CONTEXT.md`；决策记录：`docs/adr/`。

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
