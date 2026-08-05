# 汇总局域网联机规格与验收边界

Type: grilling
Mode: HITL
Status: resolved
Blocked by: 07, 08

## Question

如何把本地图已决议内容汇总为一份可交给 `/to-tickets` 的索引型 `spec.md`（问题、方案、用户故事、实现决策、测试/验收、Out of scope），并明确 Windows 主机与客人桌面 Chrome/Edge 的验收清单，而不把公网、mDNS、最近房间、强制 TLS、移动端等范围外项写进交付？

## Answer

最终交付物是索引型规格 [`spec.md`](../spec.md)：联机增量的问题/方案/用户故事/实现决策（链回子票与研究）/测试与验收/Out of scope；对局规则与策划桌细节不复述，继承 [`coup-ai-mvp/spec.md`](../../coup-ai-mvp/spec.md)。

### 组织方式

- 权威细节留在各自票据与研究报告；`spec.md` 负责「能不能开工」与「怎样算做完」。
- 大厅/离线 UX 以选定指挥台变体 B 为准，链原型目录。

### 验收边界摘要

- **环境（必过）**：Windows 10/11 主机；客人桌面 Chrome/Edge；同机双浏览器 + LAN Origin 覆盖主路径。
- **环境（建议）**：两台物理机；防火墙 Private + 应用入站。
- **功能**：三入口、房间号/加入链接、大厅门禁、离席处置、座位凭证回席、主机重启续同一 run、恢复失败显式作废。
- **不验收**：公网、mDNS、最近房间、强制 TLS、移动端、非 Windows 主机、客人跑 Agent、换主机、多房/同房再开一局。

完成本清单即可认为局域网联机规格已可交给 `/to-tickets`；实施本身不在本地图内。

## Comments
