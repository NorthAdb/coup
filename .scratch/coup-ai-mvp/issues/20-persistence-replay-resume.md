# 20 — 持久化、事件回放与快照恢复

**What to build:** 对局快照与事件写入本地 SQLite；可浏览事件列表作为回放；技术中止或进程重启后，能从故障前快照继续一局恢复运行。

**Blocked by:** 15 — 完整角色行动与规则边界（Stub）

**Status:** resolved

- [x] 成功命令在事务中追加事件并更新快照
- [x] 可打开对局事件列表浏览
- [x] 服务重启后能恢复未结束对局的关键进度
- [x] 技术中止记录无胜者，且可从快照创建恢复运行
- [x] 不把凭据或原始模型 transcript 写入数据库

## Answer

用 `node:sqlite`（`DatabaseSync`）实现 `MatchStore`：`match_runs` 存快照与座位元数据，`match_events` 按单调 `seq` 追加；`createRun` / `commitCommand` / `technicalAbort` 均在事务内提交。

`matchRuntime` 通过 `MatchPersistence` 在每次成功领域命令后落库。`createApp` 启动时加载未结束对局；`GET /api/matches/current` 续跑 Agent 座位；`GET /api/matches`、`GET /api/matches/:id/events`、`POST /api/matches/:id/resume` 覆盖列表、事件浏览与从技术中止快照开新运行。中止原因只写脱敏类别码。默认库路径 `~/.coup/coup.sqlite`（可用 `COUP_DB_PATH` 覆盖）。开局页提供继续未结束对局、事件列表与从快照恢复；「返回开局」只清客户端，服务端进度保留。
