Status: ready-for-agent

# 《政变》局域网联机规格

## Problem Statement

本机 MVP 已能在 Windows 上与本机 Agent 对弈，但同局域网的其他人类无法入座。需要在不改权威对局规则内核的前提下，增加「主机创建房间 / 客人加入 / 大厅占座开局 / 断线回席 / 主机重启恢复」，使 2–6 人桌可以由主机人类、远程人类与可选本机 Agent 组成并打完整局。网络仅限信任局域网；不做公网、匹配或强账号体系。

## Solution

在现有本机网页应用上增加双入口：本机对战（续 loopback）与局域网（创建房间 / 加入房间）。主机模式显式监听 `0.0.0.0`，用 4 位房间号与含 LAN IP:端口的加入链接邀请客人；大厅采用指挥台信息架构（邀请门禁左栏、座位矩阵右栏）；对局桌复用现有策划桌。远程人类凭座位凭证回席；离席有宽限与软超时及主机处置；主机进程重启后可恢复同一房间与同一未结束对局 run。Agent CLI 与凭据只在主机。形态与验收索引对齐 [`coup-ai-mvp/spec.md`](../coup-ai-mvp/spec.md)；对局规则与策划桌细节以该规格为准，本规格只收口联机增量。

## User Stories

1. As a 本地玩家, I want 首页能选本机对战、创建房间或加入房间, so that 单机与联机入口分开、不混在同一表单。
2. As a 主机, I want 选择创建房间后服务重绑到可被局域网访问的地址并打开 LAN URL, so that 客人能连上同一权威服务。
3. As a 主机, I want 看到 4 位房间号并一键复制加入链接, so that 我能用聊天工具邀请同网玩家。
4. As a 主机, I want 在多网卡时手选展示用的局域网 IP, so that 链接不会指向客人不可达的地址。
5. As a 客人, I want 粘贴完整加入链接进入房间, so that 我不必手敲 IP。
6. As a 客人, I want 也能手填主机地址与房间号加入, so that 没有可点击链接时仍能进房。
7. As a 客人, I want 不能只靠房间号加入, so that 弱门禁不会在未指向主机时误用。
8. As a 主机, I want 座位 1 固定为我的本地人类座位, so that 主机身份与本机控制权清楚。
9. As a 主机, I want 将其余座位设为开放占座、本机 Agent 或关闭, so that 我能混搭远程人类与 Agent。
10. As a 客人, I want 占一个开放人类座位并修改自己的显示名, so that 我能入席且桌上可辨认。
11. As a 主机, I want 仅当有效座位 2–6、无开放空槽且 Agent 就绪时才能开局, so that 不会开到一半缺人或 Agent 不可用。
12. As a 主机, I want 开局不强制已有远程人类占座, so that 我可以先开「主机 + Agent」局域网房再等人。
13. As a 远程人类, I want 断线后先有重连宽限再进入离席等待, so that 短暂闪断不立刻毁体验。
14. As a 主机, I want 离席超时后能继续等待、换本机 Agent、技术中止或强制揭示淘汰, so that 对局不会无人可推进。
15. As a 远程人类, I want 凭座位凭证回席认回原座位, so that 刷新或重开链接后还能续玩。
16. As a 客人, I want 主机进程消失时看到等待提示并在恢复后自动或经新链接回席, so that 我知道该等还是该换链接。
17. As a 主机, I want 重启服务后恢复未结束的房间与对局（同一 run）, so that 崩溃不等于整局作废。
18. As a 主机, I want 恢复失败时得到明确提示并作废旧房后才能开新房, so that 不会静默顶替房间号坑客人。
19. As a 安全敏感用户, I want Agent 凭据与 CLI 只在主机、浏览器不持有 provider 密钥, so that 客人机无法滥用主机 Agent。
20. As a 开发者, I want 领域与协议继续不绑定 loopback 或唯一本地玩家, so that 远程人类座位控制器是一等公民。

## Implementation Decisions

### 继承本机 MVP（不重开）

- 对局规则、权威状态机、`SeatView`/`SeatDecision`、策划桌、Agent 适配与有界重试、技术中止后的「恢复运行」等以 [`coup-ai-mvp/spec.md`](../coup-ai-mvp/spec.md) 为准。
- 术语以根目录 [`CONTEXT.md`](../../CONTEXT.md) 为准（房间 ≠ 对局；主机 ≠ 本地人类；离席/回席/座位凭证）。见 [定义房间与远程座位的领域语言](issues/01-define-room-and-remote-seat-language.md)。

### 监听与防火墙

- 本机对战：继续 bind loopback（随机端口行为可保留）。
- 主机模式：显式 `listen` `0.0.0.0`；加入链接写枚举所得非 loopback Preferred IPv4；不把改绑 alone 当作联机产品。
- 防火墙：优先为宿主应用开 **Private** 入站（优于裸开端口），建议 `LocalSubnet`；网络分类须为 Private。详见 [研究报告](research/windows-lan-bind-and-firewall.md)、[核验 Windows 局域网监听…](issues/02-verify-windows-lan-bind-and-firewall.md)。

### 房间号、加入链接与端口

- 房间号：4 位数字，创建时随机，冲突重抽。
- 加入链接：`http://<lan-ipv4>:<port>/join?code=####`；UI 另展示房间号与一键复制。
- 多网卡：启发式默认（RFC1918 优先 `192.168/16`→`10/8`→`172.16/12`，排除常见虚拟适配器名）；可手选；无候选则报错，禁止填 `127.0.0.1`。
- 端口：主机模式默认尝试 **8787**，占用则 OS 随机端口并在 UI/链接展示；第一版不可用户配置端口。
- 手动加入：完整链接，或「IP:端口 + 房间号」；禁止仅房间号。见 [钉死房间码格式与加入链接形态](issues/04-define-room-code-and-join-link.md)。

### 会话、Origin 与座位凭证

- 按各客户端实际入口 Origin 维持精确 Origin + HttpOnly/`SameSite=Strict` Cookie + CSRF；废除「单一 loopback 会话 = 唯一人类」。
- `127.0.0.1` 与 LAN IP 为不同 origin/site；主机宜与客人同用 LAN URL。
- 座位凭证与进程会话 Cookie 分离，绑定房间+座位，服务端存哈希；主载体为加入 Origin 上的 HttpOnly Cookie；回席成功轮换。详见 [研究报告](research/lan-session-and-reconnect-token.md)、[核验多客户端会话…](issues/03-verify-lan-session-and-reconnect-token.md)。

### 双入口、大厅与开局门禁

- 三入口首页；本机开局页与大厅配置分离。
- 进入主机模式：重绑 → 导航到 LAN Origin → 大厅；回本机对战须先解散房间再切 loopback。
- 座位槽：座 1 本地人类；其余 **开放占座** / **本机 Agent** / **关闭**；客人可改己名。
- 开局门禁（仅主机）：有效座 2–6；无「开放占座」空槽；Agent 探测就绪且开始时服务端复检；不强制已有远程人类。见 [钉死双入口与大厅配置开局门禁](issues/06-define-dual-entry-and-lobby-gates.md)。

### 大厅 / 离线 UX（原型选定）

- 采用指挥台变体 B：入口左创建/右加入+本机；大厅左邀请+门禁、右座位矩阵；对局断线右侧抽屉承载等待与主机处置。原型：[prototypes/lobby-join-reconnect](prototypes/lobby-join-reconnect/)。见 [原型化大厅加入与离线重连提示](issues/07-prototype-lobby-join-and-reconnect-ux.md)。
- 对局桌复用现策划桌，不在本规格重做。

### 离席、等待与主机处置

- 通道断开 → **15s** 宽限（重连中，不因该座暂停）→ 离席 + **5min** 软超时；座位卡显示状态与剩余时间。
- 若正轮到该座则决策点暂停；否则可继续至下次需要该座。
- 主机处置：继续等待（再 5min）/ 换本机 Agent（作废旧凭证）/ 技术中止 / 强制揭示淘汰；软超时后必须选。
- 座位凭证：软超时本身不废；回席成功轮换；换 Agent/淘汰/中止/终局/解散时作废。见 [钉死远程座位重连、等待与主机处置策略](issues/05-define-reconnect-wait-and-host-disposition.md)。

### 主机重启恢复

- 大厅与已开局对局均持久化（房间号、槽位、占座、凭证哈希；已开局关联未结束 run）。
- 主机重启 = **继续同一 run**（同一 `matchId`/事件序号）；不等于 `technical_abort` 后的新「恢复运行」。
- 客人：原 Origin 自动重试回席；Origin 变则用新加入链接 + 凭证。
- 宕机期间**冻结**离席软超时；恢复后再给短宽限（15s）。
- Agent 槽保留并重绑探测；未就绪则决策点暂停，不因重启本身规则淘汰。
- 恢复失败：显式提示；放弃并作废旧房/凭证后才能开新房；禁止静默顶替房间号。见 [钉死主机重启后的房间与对局恢复边界](issues/08-define-host-restart-recovery.md)。

### 产品边界（已钉）

- 同时仅一房、一房一局；终局后不在同一房间再开一局。
- 不做 mDNS/最近房间；信任同网 + 房间号弱门禁；不做强制 TLS/完整账号。
- 客人机不运行 Agent；权威状态不迁移到新主机。
- 主机：Windows 10/11；客人验收：桌面 Chrome/Edge。

## Testing Decisions

- 对局规则主 seam 仍在领域核心（继承 MVP）；本规格增量以手工验收与少量编排/会话冒烟为主。
- 联机相关自动化可覆盖：房间号格式与冲突、开局门禁谓词、离席状态机计时（可注入时钟）、凭证绑定与轮换、恢复加载同一 `matchId`——不断言 UI 布局细节。
- 发布验收以下列清单为准。

### 验收清单（必过）

- Windows 10/11 主机；本机对战仍仅 loopback；创建房间后监听可被 LAN 访问且浏览器在 LAN Origin
- 三入口；4 位房间号；复制 `/join?code=` 链接；手填地址+房间号可加入；拒绝仅房间号
- 大厅为指挥台 IA：左邀请/门禁、右座位矩阵；座 1 本地人类；开放/Agent/关闭可配
- 开局门禁：有效座 2–6、无开放空槽、Agent 就绪；服务端复检
- **同机双浏览器 + LAN Origin**：占座、改名、开局、对局决策、座位凭证回席
- 断线：15s 宽限 → 离席+5min；主机四处置可用；策划桌复用且离线提示在右侧抽屉信息架构下可理解
- 主机进程重启后可恢复同一房间；已开局则续同一 run；宕机期间离席钟冻结
- 恢复失败有明确文案且须作废旧房后才能开新房
- Agent 仅主机侧；客人桌面 Chrome/Edge 可完成加入与对局
- 无公网、无 mDNS、无最近房间、无强制 TLS、无原版美术分发

### 验收清单（建议，不挡规格完工）

- 两台物理机联通
- 防火墙 Private 配置文件下应用入站（或等价）后客人可连

## Out of Scope

- 本规格交付的是可实施说明与验收标准；写作规格本身不等于已实现联机。
- 公网联机、匹配服、NAT 穿透、mDNS/局域网自动发现列表。
- 最近房间（服务端或主机侧记忆）。
- 强制 TLS、完整账号体系、对抗恶意同网攻击者。
- 客人机运行 Agent；权威状态迁移到新主机。
- 同进程多房间并行；终局后同一房间再开一局。
- 移动端浏览器验收；非 Windows 主机；Safari 专项。
- 扩展角色、热座、纯观战席；Agent 人格/牌力评测。
- 重做策划桌或本机 MVP 已交付的规则内核。

## Further Notes

- 决策地图：[`map.md`](map.md)；细节在 `issues/` 与 `research/`。
- UI 原型：[`prototypes/lobby-join-reconnect`](prototypes/lobby-join-reconnect/)（选定 B）。
- 本机 MVP 规格与实现前提：[`../coup-ai-mvp/spec.md`](../coup-ai-mvp/spec.md)。
- 建议实施顺序：房间/大厅持久化与监听切换 → 会话多 Origin 与座位凭证 → 加入/大厅 UI（指挥台）→ 开局门禁接线现有对局 → 离席/处置 → 主机重启恢复 → 按验收清单收口。
- 下一技能步骤：每张实现票单独 `/implement`。实现票：
  - [10 主机模式监听与房间邀请](issues/10-host-bind-and-room-invite.md)
  - [11 多 Origin 会话与座位凭证占座](issues/11-multi-origin-session-and-seat-claim.md)
  - [12 指挥台大厅配置与开局对局](issues/12-lobby-console-and-start-match.md)
  - [13 离席、回席与主机处置](issues/13-absence-resume-and-host-disposition.md)
  - [14 主机重启后的房间与对局恢复](issues/14-host-restart-room-match-recovery.md)
  Frontier：10（可立即开始）。
