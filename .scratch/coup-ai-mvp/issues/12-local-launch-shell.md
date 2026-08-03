# 12 — 本地启动壳

**What to build:** 在 Windows 上安装依赖后，用一条命令启动本机 loopback 服务并自动打开浏览器，看到占位网页，确认应用壳可跑。

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] 一条 npm 命令可启动本地服务
- [x] 服务只绑定 `127.0.0.1`
- [x] 自动打开系统默认浏览器并显示占位页
- [x] 工作区按约定拆好网页、本地服务、领域与协议包的骨架

## Answer

npm workspaces 骨架已就位（`apps/web`、`apps/server`、`packages/domain`、`packages/protocol`）。根目录 `npm start` 会构建网页、在 `127.0.0.1` 随机端口启动 Fastify 静态托管并打开系统默认浏览器；占位页显示「政变」品牌与壳就绪说明。

## Comments
