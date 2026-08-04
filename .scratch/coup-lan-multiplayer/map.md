# 《政变》局域网联机规格决策地图

## Destination

产出一份可实施的局域网联机规格（形态对齐 [`coup-ai-mvp/spec.md`](../coup-ai-mvp/spec.md)），使同局域网内可以：主机创建房间、他人凭房间号/加入链接加入、座位为「主机人类 + 远程人类 + 可选本机 Agent」（2–6 人）、打完整局；对局中断线后能凭座位重连令牌续玩。网络仅限局域网；安全按信任同网 + 房间号弱门禁；Agent CLI/凭据只在主机。规格写清实现决策、验收与 Out of scope，供后续 `/to-tickets` 拆票。

## Notes

- 本地图只做规划与决策（含大厅原型），不实施联机功能本身；规格票关闭即到达 Destination。
- 继承 [`确定局域网演进边界`](../coup-ai-mvp/issues/09-preserve-lan-evolution-boundary.md)：主机权威；不能靠改绑 `0.0.0.0` 冒充联机；领域/协议不绑定 loopback；座位控制器含 `remote-human`。
- 产品偏好（制图时已钉，细规由子票收口）：双入口（本机对战 ∥ 局域网主机/加入）；短码 + 主机展示含 IP/端口的加入链接；不做 mDNS；主机独掌大厅配置与开局；浏览器座位重连令牌；主机不可替代但重启可恢复；远程断线以等待重连为主、超时后主机处置；一房一局、同时仅一房、不做最近房间；主机 Windows 10/11；客人桌面 Chrome/Edge；信任局域网。
- 对局桌复用现有策划桌；新做的是入口/房间/大厅/离线与重连提示。
- 涉及领域语言时用 `/domain-modeling` 维护根目录 `CONTEXT.md`（注意现有术语将「房间」列为 Match 的 Avoid——联网大厅的「房间」须另立术语，不得与对局混用）。
- 研究优先一手来源（Windows 防火墙/网络、本仓库协议与服务代码、浏览器 Cookie/Origin 规范）。

## Decisions so far

<!-- 关闭的子票在此索引；决策细节只活在票内 -->

- [核验 Windows 局域网监听、本机 IP 与防火墙准入](issues/02-verify-windows-lan-bind-and-firewall.md) — 主机模式绑 `0.0.0.0`、链接写枚举 LAN IPv4；防火墙 Private 应用准入（优于开端口）且网络须为 Private；详见 [研究报告](research/windows-lan-bind-and-firewall.md)。

- [核验多客户端会话、Origin/CSRF 与座位重连令牌边界](issues/03-verify-lan-session-and-reconnect-token.md) — 同源/Strict Cookie/CSRF 在各自入口 Origin 内仍成立，须改单一 loopback Origin 假设；重连令牌与会话 Cookie 分离并绑定房间+座位（HttpOnly）；`127` 与 LAN IP 为不同站；详见 [研究报告](research/lan-session-and-reconnect-token.md)。

## Not yet specified

- 多网卡时加入链接优先展示哪块地址、是否允许用户手选。
- 局域网监听端口：固定、可配置，还是随机后写入加入链接。
- 等待重连的默认软超时时长，以及超时后主机菜单的精确选项集（踢出 / 换本机 Agent / 技术中止等）。
- 大厅视觉气质与文案层级（原型后再定）。
- 本机对战入口是否仍默认只绑 loopback，与「一键切主机模式再绑局域网」的启动/切换时序。

## Out of scope

- 公网联机、匹配服、NAT 穿透、mDNS/局域网自动发现列表。
- 最近房间（服务端或主机侧记忆）。
- 强制 TLS、完整账号体系、对抗恶意同网攻击者。
- 客人机运行 Agent；权威状态迁移到新主机。
- 同进程多房间并行；终局后同一房间再开一局。
- 移动端浏览器验收；非 Windows 主机；Safari 专项。
- 扩展角色、热座、纯观战席。
