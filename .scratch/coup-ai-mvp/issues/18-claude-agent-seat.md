# 18 — Claude Code 真 Agent 座位

**What to build:** 某一 Agent 座位改用本机 Claude Code，行为与 OpenCode 座位对等：SeatView / SeatDecision、禁工具、合法行动可完成对局。

**Blocked by:** 15 — 完整角色行动与规则边界（Stub）；16 — 开局配置页

**Status:** resolved

- [x] 开局可为某座位选择 Claude Code
- [x] 使用本机 CLI 登录态，应用内不配置 API key
- [x] SeatView / SeatDecision 与校验路径可用
- [x] 外部工具全部禁用
- [x] 可与本地玩家完成至少若干回合合法交互

## Answer

Claude 适配器与 OpenCode 共用 SeatView/SeatDecision 协议与 runtime 校验路径；开局可选 Claude Code。以 argv 启动 `claude -p --output-format json --json-schema ... --permission-mode dontAsk --tools "" --disallowedTools "*"`，复用本机 CLI 登录态，应用内不配置 API key。编排冒烟（注入假适配器）覆盖 OpenCode+Claude 混座推进；真 CLI 多回合依赖本机登录态手工验收。超时重试与技术中止归票 21。
