# 19 — 开局能力探测与就绪门禁

**What to build:** 进入开局页即探测 CLI 是否存在、认证是否就绪、可用模型列表；每个 AI 座位显示就绪状态；未全部就绪不能开局，并可手动重新检测。

**Blocked by:** 17 — OpenCode 真 Agent 座位；或 18 — Claude Code 真 Agent 座位（至少一个真适配器完成后即可开工，两者都就绪后验收完整门禁）

**Status:** resolved

- [x] 进页自动探测，不回传密钥或账号明文
- [x] 每座位显示就绪 / 未安装 / 未认证 / 无模型等状态
- [x] 未就绪时禁用开始，并给出可操作提示
- [x] 「重新检测」可用
- [x] 可按座位选择探测到的模型

## Answer

落地 `GET /api/capabilities` 与开局门禁：本地服务探测 OpenCode（`--version` / `providers list` / `models`）与 Claude（`--version` / `auth status` 仅读 `loggedIn`）；响应只含脱敏状态、版本与模型目录，不回传令牌或账号字段。开局页进页自动探测、显示每座位就绪状态、未就绪禁用「开始」并提示、「重新检测」可用；可选探测到的模型（OpenCode 为 `provider/model` 目录；Claude 无 CLI 模型列表，认证就绪后提供 sonnet/opus/haiku 别名）。`POST /api/matches` 再做一次服务端复检。Stub 仍为本地回退且跳过 CLI 门禁。假 CLI 夹具覆盖脱敏与状态映射。
