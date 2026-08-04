# 《政变》局域网联机规格决策地图

## Destination

产出一份可实施的局域网联机规格（形态对齐 [`coup-ai-mvp/spec.md`](../coup-ai-mvp/spec.md)），使同局域网内可以：主机创建房间、他人凭房间号/加入链接加入、座位为「主机人类 + 远程人类 + 可选本机 Agent」（2–6 人）、打完整局；对局中断线后能凭座位重连令牌续玩。网络仅限局域网；安全按信任同网 + 房间号弱门禁；Agent CLI/凭据只在主机。规格写清实现决策、验收与 Out of scope，供后续 `/to-tickets` 拆票。

## Notes

- 本地图只做规划与决策（含大厅原型），不实施联机功能本身；规格票关闭即到达 Destination。
- 继承 [`确定局域网演进边界`](../coup-ai-mvp/issues/09-preserve-lan-evolution-boundary.md)：主机权威；不能靠改绑 `0.0.0.0` 冒充联机；领域/协议不绑定 loopback；座位控制器含 `remote-human`。
- 产品偏好（制图时已钉，细规由子票收口）：双入口（本机对战 ∥ 局域网主机/加入）；短码 + 主机展示含 IP/端口的加入链接；不做 mDNS；主机独掌大厅配置与开局；座位凭证回席；主机不可替代但重启可恢复；远程离席以等待回席为主、超时后主机处置；一房一局、同时仅一房、不做最近房间；主机 Windows 10/11；客人桌面 Chrome/Edge；信任局域网。
- 对局桌复用现有策划桌；新做的是入口/房间/大厅/离线与重连提示。
- 涉及领域语言时用 `/domain-modeling` 维护根目录 `CONTEXT.md`；对局与房间已切开，联机词汇见 [定义房间与远程座位的领域语言](issues/01-define-room-and-remote-seat-language.md)。
- 研究优先一手来源（Windows 防火墙/网络、本仓库协议与服务代码、浏览器 Cookie/Origin 规范）。
- 监听事实（已研究）：本机对战续绑 loopback；主机模式显式 `0.0.0.0`，加入链接写枚举 LAN IPv4；改绑 alone ≠ 联机产品。
- 会话事实（已研究）：按各客户端实际入口 Origin 维持精确 Origin + Strict Cookie + CSRF；废除「单一 loopback 会话 = 唯一人类」；座位凭证与进程会话 Cookie 分离、绑定房间+座位、主载体为加入 Origin 上的 HttpOnly Cookie；主机宜与客人同用 LAN URL。

## Decisions so far

- [定义房间与远程座位的领域语言](issues/01-define-room-and-remote-seat-language.md) — 房间≠对局；大厅为开局前阶段；主机≠本地人类；远程人类/占座/离席/回席/座位凭证入 [`CONTEXT.md`](../../CONTEXT.md)。
- [核验 Windows 局域网监听、本机 IP 与防火墙准入](issues/02-verify-windows-lan-bind-and-firewall.md) — 主机模式绑 `0.0.0.0`、链接写枚举 LAN IPv4；防火墙 Private 应用准入（优于开端口）且网络须为 Private；详见 [研究报告](research/windows-lan-bind-and-firewall.md)。
- [核验多客户端会话、Origin/CSRF 与座位重连令牌边界](issues/03-verify-lan-session-and-reconnect-token.md) — 同源/Strict Cookie/CSRF 在各自入口 Origin 内仍成立，须改单一 loopback Origin 假设；座位凭证与会话 Cookie 分离并绑定房间+座位（HttpOnly）；`127` 与 LAN IP 为不同站；详见 [研究报告](research/lan-session-and-reconnect-token.md)。
- [钉死房间码格式与加入链接形态](issues/04-define-room-code-and-join-link.md) — 4 位数字房间号；`/join?code=` 可复制链接；多网卡启发式默认可手选；端口默认 8787 冲突回退；手动加入需链接或「地址+房间号」。
- [钉死远程座位重连、等待与主机处置策略](issues/05-define-reconnect-wait-and-host-disposition.md) — 15s 宽限后离席+5min 软超时；按需暂停；主机可继续等待/换 Agent/技术中止/强制揭示淘汰；座位凭证软超时不废、回席轮换。
- [钉死双入口与大厅配置开局门禁](issues/06-define-dual-entry-and-lobby-gates.md) — 进主机模式重绑并改开 LAN URL；座 1 固定本地人类、其余开放占座/Agent/关闭；三入口首页；开局需 2–6 有效座、无开放槽、Agent 就绪并服务端复检。
- [原型化大厅加入与离线重连提示](issues/07-prototype-lobby-join-and-reconnect-ux.md) — 选定指挥台变体 B：入口左创建/右加入+本机；大厅左邀请门禁、右座位矩阵；断线右侧抽屉处置。原型见 [prototypes/lobby-join-reconnect](prototypes/lobby-join-reconnect/)。
- [钉死主机重启后的房间与对局恢复边界](issues/08-define-host-restart-recovery.md) — 大厅+对局均可恢复；重启续同一 run（≠ technical_abort 新恢复运行）；客人自动回席/Origin 变则新链接+凭证；宕机冻结离席钟；失败显式作废旧房；Agent 重绑探测。
- [汇总局域网联机规格与验收边界](issues/09-define-lan-acceptance-spec.md) — 交付索引型 [`spec.md`](spec.md)；同机双浏览器+LAN Origin 必过；两台物理机/防火墙为建议项；细节链子票，继承本机 MVP 规格。
- [11 多 Origin 会话与座位凭证占座](issues/11-multi-origin-session-and-seat-claim.md) — `coup_session`+CSRF 与 `coup_seat` 分离；Origin 允许列表覆盖 LAN/loopback；座 1 本地人类、开放座可占可改名；双客户端可见占座。
- [12 指挥台大厅配置与开局对局](issues/12-lobby-console-and-start-match.md) — 主机配置 open/Agent/关闭；开局门禁；`remote_human` 入域并按座位凭证投影/决策。
- [13 离席、回席与主机处置](issues/13-absence-resume-and-host-disposition.md) — 15s 宽限→离席+5min；按需暂停；四处置与凭证轮换；桌右侧抽屉。
- [14 主机重启后的房间与对局恢复](issues/14-host-restart-room-match-recovery.md) — `lan_active_room` 持久化；重启续同一 run；宕机冻结离席钟+恢复宽限；失败须放弃旧房；薄 UX。

## Not yet specified

（无。本地图 Destination 已达成：可实施规格已交付。）

## Out of scope

- 公网联机、匹配服、NAT 穿透、mDNS/局域网自动发现列表。
- 最近房间（服务端或主机侧记忆）。
- 强制 TLS、完整账号体系、对抗恶意同网攻击者。
- 客人机运行 Agent；权威状态迁移到新主机。
- 同进程多房间并行；终局后同一房间再开一局。
- 移动端浏览器验收；非 Windows 主机；Safari 专项。
- 扩展角色、热座、纯观战席。
