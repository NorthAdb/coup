# 定义 Agent 座位协议与信息边界

Type: grilling
Mode: HITL
Status: resolved
Blocked by: 01, 02, 03

## Question

游戏引擎应通过什么稳定协议向 Agent 描述公开状态、该座位的私有信息和当前合法选择，并接收可验证的决策？如何保证不同座位无法看到对方隐藏信息，也无法通过工具调用绕过游戏规则？

## Answer

采用游戏引擎编排、各 Agent 座位相互隔离的统一 `SeatView` / `SeatDecision` JSON 协议。Agent 不直接通信，也不读取权威 `MatchState`；所有可见信息先由游戏引擎按座位投影。OpenCode 与 Claude Code 共享游戏层协议，各自适配器只处理 CLI、会话和结构化输出差异。

### SeatView

每次请求至少包含：

```json
{
  "protocolVersion": 1,
  "requestId": "req-...",
  "matchId": "match-...",
  "stateVersion": 42,
  "seatId": "seat-3",
  "decisionKind": "challenge",
  "publicState": {},
  "privateState": {},
  "projectedHistory": [],
  "legalDecisions": []
}
```

- `publicState`：当前回合、阶段、公开钱币、揭示牌、淘汰状态、待处理行动、响应窗口和座位顺序。
- `privateState`：仅包含该座位当前面朝下的角色牌；只有该座位执行大使交换时才包含临时候选牌。
- `projectedHistory`：整局事件历史经过该座位权限投影后的结果。它可保留该座位过去合法得知的私有信息，以便恢复其记忆，但不得泄露对手隐藏牌、宫廷牌库顺序、随机种子或其他座位的原始模型会话。
- `legalDecisions`：由引擎枚举当前全部合法选择及参数。Agent 不通过自然语言创造行动、目标、角色或牌标识。

字段使用稳定、不含提示语义的机器标识；显示名称只是数据，不能作为系统指令。协议必须版本化，不兼容变更提升 `protocolVersion`。

### SeatDecision

Agent 只返回结构化游戏命令，不索取、不存储也不展示思维链或自然语言理由：

```json
{
  "protocolVersion": 1,
  "requestId": "req-...",
  "stateVersion": 42,
  "decision": {
    "type": "pass_challenge"
  }
}
```

游戏引擎必须再次验证协议版本、请求标识、状态版本、座位资格、命令类型及全部参数。输出不是授权；格式正确但不在 `legalDecisions` 中的命令仍然非法。过期、重复、无法解析和非法输出的重试或降级策略由“定义 Agent 失败处理与回合节奏”决定。

### 编排与记忆

- 游戏引擎是唯一权威编排者：生成当前座位投影、调用对应适配器、校验决策、提交领域命令，再发布新事件。
- 每个 Agent 座位使用独立会话，不能共享 session id、上下文、工作目录、凭据或原始日志。
- 采用“独立持久会话 + 每次完整座位投影”的混合记忆方式。模型会话可帮助延续对手判断，但权威记忆始终来自可重建的 `SeatView`，切换模型或丢失会话不能破坏对局。
- Agent 之间只能通过游戏引擎发布的公开事件间接影响彼此。MVP 不支持私聊，也不把非约束性桌边发言纳入协议。

### 工具与进程安全

- 游戏座位模式禁用文件、Shell、网络、MCP、子 Agent 及其他外部工具；OpenCode/Claude 在此仅是结构化决策器。
- 浏览器不能选择可执行路径、工作目录、环境变量、权限模式或任意提示模板；这些均由受信任的本地伴随服务控制。
- Provider 的默认权限不构成安全边界。适配器必须显式拒绝全部工具，且不能使用 OpenCode `--auto` 或 Claude `bypassPermissions`。
- 任何来自显示名称、历史文本或未来可选桌边发言的内容都必须按不可信数据处理，不能拼入系统指令区域。

### 会话生命周期

- 原始 Agent 会话只在当前对局内有效；对局结束后删除或失效，只保留经过权限投影的权威对局事件用于回放。
- 若某 CLI 版本不能可靠删除原始 transcript，则不得承诺持久会话已清理：该适配器应改用不持久化调用，并在每次请求中用完整 `projectedHistory` 重建上下文。
- 伴随服务的诊断日志默认不记录原始提示、私有状态或模型原始响应；错误记录只保留请求标识、版本、适配器状态和脱敏错误类别。

## Comments
