# Windows 局域网监听、本机 IP 与防火墙准入

调查日期：2026-08-04  
目标环境：Windows 10/11 主机；Node.js + Fastify（本仓库 `apps/server`）  
结论状态：可指导规格；未实施产品改动

## 结论

1. **本仓库今天只绑 loopback。** `startServer` 固定 `host: "127.0.0.1"`，并在绑定后拒绝非 loopback 地址；测试亦断言仅 `127.0.0.1`。局域网浏览器无法连上，这是刻意边界，不是遗漏配置。
2. **局域网主机模式应显式 `listen` 到 `0.0.0.0`（全 IPv4 接口），加入链接则填具体局域网 IPv4。** 绑 `127.0.0.1`/`localhost` 仍仅本机；绑某一网卡 IP 在 DHCP/换网后易 `EADDRNOTAVAIL`；省略 Fastify `host` 会落到默认 `localhost`（仍非局域网）。`0.0.0.0` 与「展示给客人的 IP」是两件事。
3. **可写入加入链接的本机 IPv4：用 `os.networkInterfaces()`（应用内）或 `Get-NetIPAddress -AddressFamily IPv4`（运维/诊断），过滤掉 loopback / 非 Preferred / 典型链路本地。** 多网卡时「选哪一个」无官方单一算法，属产品决策（地图已单列）。
4. **防火墙：保持开启；为 Node/宿主可执行文件开入站允许，并限定 Private（或当前信任网络配置文件）；优先应用规则而非永久开端口；可选 `RemoteAddress LocalSubnet`。** 仅开规则不够——主机当前网络若被标为 Public，Private 规则不会生效。本机探测见 WLAN=`Public`。
5. **官方/一手支持 vs 民间经验见文末对照表。** 关掉防火墙、盲目 `Any` 配置文件、或假设「绑了 `0.0.0.0` 就等于联机产品」均无官方背书。

## 本仓库当前绑定（一手：源码）

[`apps/server/src/startServer.ts`](../../../apps/server/src/startServer.ts)：

- 常量 `LOOPBACK_HOST = "127.0.0.1"`。
- `await app.listen({ host: LOOPBACK_HOST, port: options.port ?? 0 })`。
- 绑定后若 `address.address !== LOOPBACK_HOST` 则关闭并抛错。
- 对外 URL 写死为 `http://127.0.0.1:<port>/`。

[`apps/server/src/startServer.test.ts`](../../../apps/server/src/startServer.test.ts) 断言 `started.host === "127.0.0.1"` 且 URL 匹配 loopback。

含义：从「仅本机」到「同局域网可访问」，必须改 listen host（并去掉/放宽拒绝非 loopback 的守卫），同时另做加入链接用的可达 IPv4 枚举与防火墙准入——改绑本身不等于完整联机产品（与地图 Notes 一致）。

## Listen 地址：`0.0.0.0` vs 特定 IP vs `127.0.0.1`

### Node.js `net.Server#listen`（一手）

来源：[Node.js Net — `server.listen([port[, host[, backlog]]][, callback])`](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback)

| `host` | 官方语义 | 对局域网客人 |
| --- | --- | --- |
| 省略 | IPv6 可用时绑未指定地址 `::`，否则绑 `0.0.0.0`；多数 OS 上绑 `::` 也会接受 IPv4（可用 `ipv6Only: true` 关掉） | 可能从非 loopback 到达，但双栈细节依赖 OS |
| `0.0.0.0` | 未指定 IPv4 地址（unspecified IPv4） | 在所有 IPv4 接口上接受连接 |
| 具体网卡 IPv4 | 只绑该地址 | 仅当客人打到该 IP 且该地址仍在本机时可达 |
| `127.0.0.1` | loopback | 仅本机；局域网不可达 |

补充（同页）：

- `port` 为 `0` 时由 OS 分配空闲端口，之后用 `server.address().port` 读取——与本仓库 `port ?? 0` 一致。
- 监听在 `0.0.0.0` 时，已接受连接的 `socket.localAddress` 会是客户实际打到的接口地址（文档示例：客户端连 `192.168.1.1` 时 localAddress 为该值）。
- 地址当前不可用时错误码含 `EADDRNOTAVAIL`（[Node.js Errors](https://nodejs.org/api/errors.html) / OS 表；Net 文档亦讨论 `EADDRINUSE`）。

### Fastify `listen`（一手：本仓库依赖源码）

依赖：`fastify` ^5.5.0（[`apps/server/package.json`](../../../apps/server/package.json)）。

[`node_modules/fastify/lib/server.js`](../../../node_modules/fastify/lib/server.js)：

- 默认 `listenOptions = { port: 0, host: 'localhost' }`；未传 `host` 时回落 `'localhost'`。
- 注释写明：`localhost` → 尝试 `127.0.0.1` 与 `::1`；显式 `127.0.0.1` → 只绑 IPv4 loopback。
- 类型/测试显式支持 `{ host: '0.0.0.0' }`（`node_modules/fastify/test/types/instance.tst.ts`）。

因此：局域网模式必须**显式**传 `host: '0.0.0.0'`（或选定网卡 IP）；不能依赖 Fastify 默认。

### 规格建议（由上述一手推导）

| 做法 | 评估 |
| --- | --- |
| 本机对战继续 `127.0.0.1` | 与现码/测试一致；局域网不可达（预期） |
| 主机模式 `0.0.0.0` + 加入链接写枚举出的 LAN IPv4 | 监听面宽、展示地址具体；DHCP 换 IP 只需更新链接，不必重绑 |
| 主机模式只绑当前 WLAN IP | 缩小暴露面，但 IP 变更/多网卡时脆弱；官方无「必须如此」要求 |
| 省略 `host` / 用 `localhost` | **不能**作为局域网方案（Fastify 默认仍是 loopback） |

## 枚举可写入加入链接的本机局域网 IPv4

### Node.js `os.networkInterfaces()`（一手，应用内首选）

来源：[Node.js OS — `os.networkInterfaces()`](https://nodejs.org/api/os.html#osnetworkinterfaces)

返回按接口名分组的地址对象，字段包括：

- `address`：IPv4/IPv6
- `family`：`'IPv4'` / `'IPv6'`（历史版本曾为数字；v18.4.0 起为字符串）
- `internal`：`true` 表示 loopback 或类似「不可远程访问」的接口

文档示例同时给出 `127.0.0.1`（`internal: true`）与 `192.168.1.108`（`internal: false`）。

**一手过滤：** `family === 'IPv4'`（或兼容旧版 `family === 4`）且 `internal === false`。

**本机 2026-08-04 实测（非规范，仅证明多地址现实）：**

| 接口 | IPv4 | `internal` |
| --- | --- | --- |
| WLAN | 192.168.1.7 | false |
| Tailscale | 169.254.83.107 | false |
| VMware VMnet1/8 | 192.168.177.1 / 192.168.79.1 | false |
| Loopback | 127.0.0.1 | true |

→ 仅 `internal === false` 仍可能得到虚拟网卡、链路本地类地址；「哪个写进默认加入链接」需产品规则（地图 *Not yet specified*）。

### PowerShell（一手，诊断/运维）

- [`Get-NetIPAddress`](https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-netipaddress)：获取 IPv4/IPv6 与关联接口；`-AddressFamily IPv4` 合法。
- `-AddressState Preferred`：**Preferred** =「valid and available for use」（同页参数说明）。Tentative/Duplicate/Invalid/Deprecated 不宜写入加入链接。
- `-PrefixOrigin`：含 `Dhcp`、`Manual`、`WellKnown` 等；本机 169.254.* 多为 `WellKnown`。
- [`Get-NetConnectionProfile`](https://learn.microsoft.com/en-us/powershell/module/netconnection/get-netconnectionprofile)：读 `NetworkCategory`（`Public` / `Private` / `DomainAuthenticated`）与 `IPv4Connectivity`。

**本机同日 `Get-NetConnectionProfile`：** WLAN=`Public`（有 Internet）；Tailscale=`Private`（NoTraffic）。说明「家用 Wi‑Fi」不一定已是 Private——会影响下方防火墙规则是否生效。

### 过滤建议的证据分级

| 规则 | 分级 |
| --- | --- |
| 排除 `internal: true` / 127.0.0.1 | 一手（Node `os.networkInterfaces`） |
| 仅 `AddressState Preferred` | 一手（Get-NetIPAddress） |
| 排除 `169.254.0.0/16`（APIPA/链路本地常见段） | 合理工程启发式；Node 文档未要求；本机 Tailscale 亦落在此段且 `internal: false` |
| 排除 VMware/Hyper-V 虚拟交换机 | 民间/产品启发式；无「官方禁止列表」 |
| 多候选时默认选「有 Internet 的那块」或让用户手选 | 产品决策；`IPv4Connectivity` 可供参考（Get-NetConnectionProfile） |

## Windows Defender 防火墙准入

### 配置文件（一手）

Windows Firewall 三套配置文件：**Domain / Private / Public**，按网络位置套用不同规则。

- 概述与三配置文件说明：[Windows Firewall（Microsoft Learn）](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/)（搜索摘要与 Learn 一致：Private 面向家庭等受信网络，可由管理员手动设定；Public 为未识别网络默认、更严）。
- UI/用户向说明：[Firewall and network protection in the Windows Security app](https://support.microsoft.com/en-us/windows/firewall-and-network-protection-in-the-windows-security-app-ec0844f7-aebd-0583-67fe-601ecf5d774f) — Domain / Private / Public；建议遇阻时**放行应用**而非关闭防火墙；「阻止所有传入连接」勾选后会**忽略**已允许应用列表。
- `Get-NetConnectionProfile` 的 `NetworkCategory`：`Private` = 家用/工作、信任设备和人；`Public` = 机场/咖啡店等（[Cmdlet 文档](https://learn.microsoft.com/en-us/powershell/module/netconnection/get-netconnectionprofile)）。

### 应用 vs 端口（一手）

[Risks of allowing apps through Windows Firewall](https://support.microsoft.com/en-us/windows/risks-of-allowing-apps-through-windows-firewall-654559af-3f54-3dcf-349f-71ccd90bcc5c)：

- 两种方式：加入允许应用列表（**风险较低**）；打开端口（**风险较高**）。
- 端口会一直开着；允许应用则主要在应用需要时打开所需端口。
- UI：Windows Security → Firewall & network protection → Allow an app through firewall → Change settings → 勾选应用或「Allow another app」。
- 开端口：同一页 → Advanced settings → Inbound Rules → New Rule…。

### 可编程规则（一手）

[`New-NetFirewallRule`](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)（NetSecurity）：

- `-Direction Inbound`（默认即为 Inbound）、`-Action Allow`、`-Protocol TCP`、`-LocalPort <port>`、`-Program <完整 exe 路径>`。
- `-Profile`：`Any`（**默认**）、`Domain`、`Private`、`Public`… — **默认 Any 会覆盖所有配置文件**；局域网信任模型应显式 `-Profile Private`（若规格只信任家用网）。
- `-RemoteAddress LocalSubnet`：官方示例「Allow Messenger」使用 Program + `LocalSubnet`；参数说明含关键字 `LocalSubnet` / `LocalSubnet4`。
- Learn「防火墙规则」设计建议：家用/小企业场景宜在 private/public 规则上限制远程地址为 Local Subnet（[Windows Firewall rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)）。
- 命令行管理概况：[Configure Windows Firewall with command line](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line) — 强调默认丢弃未允许的入站；应用规则而非停服务。

### 对 Coup 局域网主机的可操作清单

1. 确认主机 Wi‑Fi/以太网的 `NetworkCategory` 为 **Private**（信任同网前提下）；若为 Public，Private-only 规则不匹配 → 客人会被挡。可用 `Get-NetConnectionProfile` / `Set-NetConnectionProfile`（官方 cmdlet）核对与调整。
2. 不要关闭防火墙；不要依赖「Blocks all incoming connections」。
3. **优先**为实际监听进程的可执行文件（如 `node.exe`，或将来打包后的宿主 exe）添加入站允许，并勾选/指定 **Private**。
4. 若端口固定且需脚本化：`New-NetFirewallRule`，显式 `-Profile Private`，建议 `-RemoteAddress LocalSubnet`，TCP + 实际端口；随机端口则应用规则比端口规则更合适（与 Microsoft「应用优于端口」一致）。
5. 首次监听时 Windows 可能弹出防火墙对话框——属常见客户端行为；规格应写清「需用户确认或预置规则」，但「一定弹窗」并非每台机器可复现的硬性 API 承诺。

## 官方 / 一手 vs 民间经验

| 主张 | 分级 | 依据 |
| --- | --- | --- |
| `127.0.0.1` 仅本机可达 | 一手 | Node `listen` + 本仓库守卫 |
| 省略 Fastify `host` ≠ 局域网 | 一手 | Fastify `lib/server.js` 默认 `localhost` |
| `0.0.0.0` 接受所有 IPv4 接口连接 | 一手 | Node Net：unspecified IPv4 |
| 加入链接应写具体 LAN IPv4，而非字面 `0.0.0.0` | 工程推导 | 客人浏览器需可路由单播地址；`0.0.0.0` 不是有效远程目标 |
| 绑死单一网卡 IP 有 `EADDRNOTAVAIL` 风险 | 一手（错误码）+ 推导 | Node Errors / 地址必须存在于本机 |
| `os.networkInterfaces` + `internal: false` 枚举候选 | 一手 | Node OS |
| `Get-NetIPAddress` / Preferred / AddressFamily | 一手 | Microsoft Learn |
| 防火墙三配置文件；Private=信任网 | 一手 | Learn + Support + Get-NetConnectionProfile |
| 允许应用优于开端口 | 一手 | Microsoft Support |
| 规则应显式 `-Profile Private`（勿默认 Any） | 一手（默认值）+ 产品风险 | New-NetFirewallRule 默认 Any |
| `RemoteAddress LocalSubnet` 适合家用共享类应用 | 一手（建议/示例） | New-NetFirewallRule 示例；Firewall rules 指南 |
| 关闭防火墙「省事」 | **反模式** | Microsoft 明确不建议关防火墙 |
| 自动选「主」网卡的通用算法 | **民间/产品** | 官方无单一排序；本机多地址实证 |
| 一律排除 169.254.* | **启发式** | 常见 APIPA；Node 未规定；可能误伤部分隧道适配器 |
| 绑 `0.0.0.0` 即完成联机产品 | **错误** | 地图/既有演进边界；尚需房间、会话、UX 等 |

## 对后续规格票的直接影响

- 本机对战 vs 局域网主机：**监听 host 必须分模式**（loopback vs `0.0.0.0`），不能只改 UI。
- 加入链接：端口来自 `server.address().port`；主机字段来自枚举后的 IPv4，不是 listen host 字面量。
- 验收应覆盖：防火墙 Private 规则 + 网络分类为 Private；以及「网络仍为 Public」时的失败提示。
- 多网卡默认地址仍属开放问题——本研究只钉「如何枚举与过滤」，不钉「默认选谁」。

## 主要来源

1. [Node.js Net — `server.listen`](https://nodejs.org/api/net.html#serverlistenport-host-backlog-callback)
2. [Node.js OS — `os.networkInterfaces`](https://nodejs.org/api/os.html#osnetworkinterfaces)
3. 本仓库 `apps/server/src/startServer.ts`、`startServer.test.ts`；`node_modules/fastify/lib/server.js`
4. [Get-NetIPAddress](https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-netipaddress)
5. [Get-NetConnectionProfile](https://learn.microsoft.com/en-us/powershell/module/netconnection/get-netconnectionprofile)
6. [New-NetFirewallRule](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule)
7. [Windows Firewall（Learn）](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/)
8. [Windows Firewall rules（Learn）](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)
9. [Configure Windows Firewall with command line](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line)
10. [Risks of allowing apps through Windows Firewall（Microsoft Support）](https://support.microsoft.com/en-us/windows/risks-of-allowing-apps-through-windows-firewall-654559af-3f54-3dcf-349f-71ccd90bcc5c)
11. [Firewall and network protection in the Windows Security app](https://support.microsoft.com/en-us/windows/firewall-and-network-protection-in-the-windows-security-app-ec0844f7-aebd-0583-67fe-601ecf5d774f)
