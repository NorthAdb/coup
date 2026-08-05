# 局域网多客户端会话、Origin/CSRF 与座位重连令牌

调查日期：2026-08-04  
目标：对照本仓库本机会话模型与浏览器/Fetch/WebSocket 一手规范，厘清 LAN 多人时哪些假设仍成立、哪些必须改，以及座位重连令牌的载体与绑定。

## 结论

1. **按「每个浏览器打开的那个 URL」看，同源 + 精确 Origin + HttpOnly/`SameSite=Strict` Cookie + CSRF 的组合仍然成立**：客人用 `http://192.168.x.x:port` 打开同源页时，其 fetch/WebSocket 与 Cookie 都落在同一 origin/site；`SameSite=Strict` 不会阻止同页发出的同站请求。
2. **必须改的是「单一 loopback Origin / 单一本机会话 = 唯一人类」假设**：`http://127.0.0.1:port` 与 `http://192.168.x.x:port` 是不同 origin，且因 IP 无 registrable domain，也是不同 site；Cookie 与 `localStorage` 互不相通。Origin 允许列表不能只钉 `127.0.0.1`；主机若用 loopback 打开，不能指望与客人共用同一 Cookie 罐。
3. **座位重连令牌应与「进程级浏览器会话 Cookie」分离**：会话 Cookie 继续做 ambient 传输认证（防外站调本机/主机 API）；重连令牌绑定 **房间（或大厅）+ 座位**，高熵、服务端存哈希、TTL 对齐断线等待窗，成功重连后轮换。载体优先：**在玩家实际加入的那个 Origin 上设置的独立 HttpOnly Cookie**（XSS 时不可读）；若产品要显式粘贴/导出令牌，再用同源 `localStorage` 或一次性展示码作辅，不替代服务端校验。
4. **当前 `apps/server` / `apps/web` 尚未实现**规格中的 Origin/Cookie/CSRF/WebSocket；实现时必须以 LAN 多 Origin 与多座位凭证为默认，而不是把 loopback MVP 凭据原样扩到 `0.0.0.0`。

## 本仓库一手来源

### 规格与架构决策（文档模型）

- 网页与 API **同源**；**精确 Origin 校验**；**启动期随机会话凭据**；**HttpOnly** 与 **`SameSite=Strict` Cookie**；**必要 CSRF 防护**。[`spec.md` Implementation Decisions](../../coup-ai-mvp/spec.md)
- 服务 MVP 绑定 `127.0.0.1`；REST + WebSocket；同源；精确 Origin + 启动期会话 + HttpOnly/`SameSite=Strict` + CSRF，避免恶意网页调用 loopback。[`issues/05-choose-local-runtime-architecture.md`](../../coup-ai-mvp/issues/05-choose-local-runtime-architecture.md)
- 局域网演进：领域/协议不依赖 Cookie 或「唯一本地玩家」；**本机会话只是传输凭证，不得进入权威 `MatchState`**；REST/WebSocket 按座位身份工作。[`issues/09-preserve-lan-evolution-boundary.md`](../../coup-ai-mvp/issues/09-preserve-lan-evolution-boundary.md)
- Out of scope 已写明：本轮不做局域网、断线重连占座。[`spec.md` Out of Scope](../../coup-ai-mvp/spec.md)
- 产品偏好（决策地图）：浏览器座位重连令牌；信任局域网；不做强制 TLS / 完整账号。[`map.md`](../map.md)

### 实际代码（实现现状，2026-08-04）

- `startServer` **硬编码** `LOOPBACK_HOST = "127.0.0.1"`，非 loopback 绑定会拒绝；打开浏览器 URL 为 `http://127.0.0.1:${port}/`。[`apps/server/src/startServer.ts`](../../../apps/server/src/startServer.ts)
- `createApp` 提供 REST（capabilities / matches / decision 等）与静态页；**无** `Origin` 校验、**无** `Set-Cookie`、**无** CSRF token、**无** WebSocket 路由。[`apps/server/src/createApp.ts`](../../../apps/server/src/createApp.ts)
- 网页用相对路径 `fetch("/api/...")`，未设 `credentials`；`localStorage` 仅存开局配置与桌面节奏等非敏感偏好，**无**会话/重连令牌。[`apps/web/src/App.tsx`](../../../apps/web/src/App.tsx)、[`matchSetup.ts`](../../../apps/web/src/matchSetup.ts)

因此：下列规范分析针对**文档已定的会话模型**及 LAN 所需变更；不是对已落地鉴权代码的回归测试。

## 浏览器 / IETF / WHATWG 一手规范

### Origin 与同源

- 同源要求 **scheme、host、port** 三者相同。[MDN Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)
- `Origin` 请求头携带发起请求的 origin（scheme + host + 可选 port）。[MDN Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin)；Fetch 定义 Origin 头行为。[Fetch Living Standard — Origin header](https://fetch.spec.whatwg.org/#http-origin)
- 故：`http://127.0.0.1:PORT` 与 `http://192.168.1.10:PORT` **不同 origin**（host 不同），即使端口与路径相同。

### Site（SameSite 所用「站」）与 IP

- 取 site：若 host 的 **registrable domain 为 null**，site 为 `(scheme, host)` 本身。[HTML — obtain a site](https://html.spec.whatwg.org/multipage/browsers.html#same-site)
- URL 标准：非 domain 的 host（含 **IP address**）其 public suffix / registrable domain 为 **null**。[URL Standard — public suffix / registrable domain](https://url.spec.whatwg.org/#host-miscellaneous)
- schemelessly same site：两 host 相等且 registrable domain 为 null 时才同站；否则比 registrable domain。[HTML — schemelessly same site](https://html.spec.whatwg.org/multipage/browsers.html#same-site)
- 推论：**`127.0.0.1` 与 `192.168.x.x` 不同 site**（scheme 可同，host 不等）。端口在 same-site 比较中被忽略，但此处 host 已不同，无帮助。

### Cookie：HttpOnly、SameSite=Strict、host-only

- `HttpOnly`：禁止 `document.cookie` 等 JS 读取；仍随同源 XHR/fetch 发送。[MDN Set-Cookie — HttpOnly](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
- 省略 `Domain` → **host-only cookie**，只回传给设置它的那个 host。[MDN Set-Cookie — Domain](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)；[RFC 6265 §5.4 Cookie header 匹配](https://datatracker.ietf.org/doc/html/rfc6265#section-5.4)
- `SameSite=Strict`：仅当请求为 **same-site** 时附带 Cookie。[draft-ietf-httpbis-rfc6265bis-15 §4.1.2.7 / §5.2](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-15#section-4.1.2.7)；[MDN SameSite](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitevalue)
- 客人页在 `http://192.168.x.x:port` 内对同 host 发 fetch：请求是 same-site → **Strict Cookie 会发送**。外站恶意页对 `http://192.168.x.x:port` 的跨站请求 → Strict **不发送**。
- 主机在 `127.0.0.1` 上拿到的 Cookie **不会**出现在对 `192.168.x.x` 的请求中（host-only + 不同 site）。
- LAN 场景通常是明文 `http:`：`SameSite=None` 需要 `Secure`，而 insecure 站点不能设 `Secure` Cookie（localhost 有特例）。[MDN Set-Cookie — Secure / SameSite=None](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) → **不能**靠 `SameSite=None` 把 Cookie「跨」到另一 IP；也不需要——正确做法是各 Origin 各自同源，而不是跨 Origin 共享 Cookie。

### CSRF

- CSRF：外站诱使浏览器带着目标站凭据发状态变更请求；典型前提是「仅靠 Cookie 认证 + 可预测参数」。[MDN Glossary: CSRF](https://developer.mozilla.org/en-US/docs/Glossary/CSRF)
- RFC 6265bis：SameSite 在 Strict 下对 CSRF 有深度防御，但**不应是唯一防御**；仍建议结合其它手段（如 CSRF token）。[draft-ietf-httpbis-rfc6265bis-15 §8.8](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-15#section-8.8)
- MDN 同源策略文档：阻止跨站写可用 **不可猜测的 CSRF token**。[MDN Same-origin policy — How to block](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy#how_to_block_cross-origin_access)
- 对 LAN：**同一 Origin 内**仍保留「会话 Cookie + 非 Cookie 的 CSRF 凭证（头/体）」合理；**不能**假设「只有一个本机玩家 Cookie」即可区分多座位。

### WebSocket

- 握手可带 Cookie（RFC 6265）；服务端可在握手中 Set-Cookie。[RFC 6455 §1 / §4 client request MAY include cookies](https://datatracker.ietf.org/doc/html/rfc6455)
- 浏览器客户端握手 **MUST** 带 `Origin`；仅服务特定站点的服务器 **SHOULD** 校验 Origin，不可接受则 **403**。[RFC 6455 §10.2 Origin Considerations](https://datatracker.ietf.org/doc/html/rfc6455#section-10.2)
- Cookie 是否附带仍受 host / path / SameSite 规则约束（与普通 HTTP 相同），不会 magically 跨 `127.0.0.1` ↔ LAN IP。

### Web Storage（备选载体）

- `localStorage` / `sessionStorage` **按 origin 隔离**；一 origin 的脚本读不到另一 origin。[MDN Web Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- 故：客人在 `192.168.x.x` 存的重连令牌，主机在 `127.0.0.1` **看不到**；刷新同 URL 可保留 `localStorage`；关标签后 `sessionStorage` 丢失。
- Storage 对 JS 可读 → XSS 可盗令牌；**敏感座位权宜优先 HttpOnly Cookie**，Storage 仅作 UX 辅助。

## 现有假设：仍成立 vs 必须改

| 假设（本机 MVP 文档） | LAN 多人 | 依据摘要 |
| --- | --- | --- |
| 网页与 API/WS **同源** | **仍成立**（前提：客人与主机都通过「加入链接上的同一 host:port」打开页，相对 URL 调 API） | MDN 同源；架构 issue 05 |
| **精确 Origin** 校验 | **语义仍成立，实现必须放宽为允许列表**（至少：当前监听所展示的 LAN origin；若主机仍用 loopback，则 **同时**允许 `http://127.0.0.1:port` 与 `http://<lan-ip>:port`）。禁止 `*` / 任意 Origin | RFC 6455 §10.2；Origin = scheme/host/port |
| 启动期 **随机进程会话** Cookie | **仍可用于「此浏览器曾打开过本服务」的 ambient 门禁**；**不能**再暗示「全桌唯一人类」或跨 IP 共享 | spec；issue 09「会话≠MatchState」 |
| `HttpOnly` + `SameSite=Strict` | **在各自 Origin 内仍成立且值得保留** | RFC 6265bis；HTML same-site + IP |
| **必要 CSRF**（Cookie 之外的 token） | **仍成立**；多座位后更不能只靠 ambient Cookie | MDN CSRF；RFC 6265bis §8.8 |
| 单一 loopback bind / 自动打开 `127.0.0.1` | **必须改**（监听与加入链接另票；会话票结论：UI 入口 Origin 与 Cookie 罐绑定） | `startServer.ts`；site/origin 边界 |
| WebSocket 重连只带事件序号 | **不足**；LAN 还需座位身份（重连令牌），序号只解决投影补洞 | issue 05 重连补发；map 产品偏好 |

## 座位重连令牌：载体与绑定

### 绑定（服务端权威）

- **作用域**：`(roomId | lobbyId, seatId)`（或开局后的 `matchId + seatId`，但大厅占座阶段尚无 match 时必须先有房间/座位主键）。令牌 **不进入** `MatchState` 领域字段（与 issue 09 一致）；只存在传输/大厅会话层。
- **熵**：不可猜测（密码学随机，长度足够）；服务端只存 **哈希** + 元数据（seat、expiry、世代）。
- **TTL**：与「断线等待 / 主机处置」窗口对齐（具体时长另票）；过期后令牌失效，座位按大厅规则释放或由主机处置。
- **轮换**：成功重连（或显式「重新发牌占座」）后 **作废旧令牌并签发新令牌**，降低 XSS/同网窃听后的重放窗口。信任局域网不等于免轮换。
- **呈现**：一人一座；刷新认回同一座位；不能用进程级「唯一会话 Cookie」冒充座位权。

### 载体比较

| 载体 | 刷新后认座 | 跨 `127`↔`192` | XSS | CSRF/ambient | 与现有模型契合度 |
| --- | --- | --- | --- | --- | --- |
| 进程会话 Cookie（现有设计） | 同 Origin 刷新通常可 | **否** | HttpOnly 则脚本不可读 | ambient，需另加 CSRF | 适合「连上了这个服务」，**不适合**座位身份 |
| **座位重连 Cookie**（推荐主载体）：独立名称，HttpOnly，`SameSite=Strict`，Path 限房间 API，**在加入时的 Origin 上 Set-Cookie** | 是 | **否（且不应跨）** | 较强 | 仍建议状态变更带 CSRF 或非简单 Cookie 触发 | 与 Strict 同源模型一致 |
| `localStorage` 令牌 + 请求头显式携带 | 是 | 否 | 弱（脚本可读） | 显式头可减轻纯 Cookie CSRF | 适合「显示/备份令牌」或无 Cookie 调试；不作唯一真相 |
| `sessionStorage` | 同标签刷新视实现；关标签丢 | 否 | 弱 | 同左 | **不适合**「刷新后认回」的产品句 |

**推荐组合（LAN）**

1. **传输会话**：启动期随机 Cookie，HttpOnly + SameSite=Strict；Origin 允许列表 = 本进程对外宣称的入口 origin（们）。
2. **座位重连**：加入/占座成功后另发 **seat-reconnect** 凭证；主载体为 **该客人 Origin 上的 HttpOnly Cookie**（或等价：服务端 Set-Cookie + 同请求自动带上）；服务端校验哈希并绑定房间+座位。
3. **CSRF**：所有会改变大厅/对局状态的 REST（及若用 cookie 鉴权的 WS 升级后的首条绑定）要求非 Cookie 秘密（同步 token 头等）；SameSite 作纵深而非唯一闸门。
4. **主机 loopback**：若主机坚持 `http://127.0.0.1`，为其单独发 **另一套** Cookie（另一 Origin）；或产品规定主机也打开加入链接中的 LAN URL，使全桌单一 site——后者运维更简单，会话实现更干净。

## 主机 `127.0.0.1` vs 客人 `192.168.x.x`

```text
http://127.0.0.1:PORT     → origin A, site (http, 127.0.0.1)
http://192.168.1.10:PORT → origin B, site (http, 192.168.1.10)
Cookie jar A ⊄ B；localStorage A ⊄ B
```

处理原则：

1. **不要**尝试用 `Domain=` 合并两个 IP（host-only 才是 IP 上的正确形态；跨 IP Domain 无合法「父域」）。
2. Origin 校验：**枚举**可接受的序列化 Origin，拒绝其它（含恶意公网页、错误 IP）。
3. 加入链接只宣传 **一个** 客人用 host（LAN IP 或用户所选网卡）；主机浏览器尽量用同一 URL，避免双 Origin 运维坑。
4. 重连令牌随 **玩家打开的 Origin** 落地；换 URL 等于换站，须重新加入或显式迁移流程（本规格地图未要求迁移）。

## 对后续规格票的直接含义

- 「重连令牌载体与主机 127 vs LAN Origin」可从 map 的 Not yet specified **毕业**为本结论：主载体 = 加入 Origin 上的 HttpOnly 座位 Cookie（会话 Cookie 分离）；主机与客人不同 host 时视为不同站，优先统一入口 URL。
- 实现时不可把当前未实现的「单 loopback 会话」原样扩到多客户端；须同时落地多 Origin 允许列表与按座位的重连凭证。

## 来源索引

- 仓库：[`spec.md`](../../coup-ai-mvp/spec.md)、[`issues/05`](../../coup-ai-mvp/issues/05-choose-local-runtime-architecture.md)、[`issues/09`](../../coup-ai-mvp/issues/09-preserve-lan-evolution-boundary.md)、[`map.md`](../map.md)、[`startServer.ts`](../../../apps/server/src/startServer.ts)、[`createApp.ts`](../../../apps/server/src/createApp.ts)、[`App.tsx`](../../../apps/web/src/App.tsx)
- MDN：[Same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)、[Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Origin)、[Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)、[CSRF](https://developer.mozilla.org/en-US/docs/Glossary/CSRF)、[Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API)
- WHATWG：[HTML same site](https://html.spec.whatwg.org/multipage/browsers.html#same-site)、[URL hosts](https://url.spec.whatwg.org/#host-miscellaneous)、[Fetch Origin](https://fetch.spec.whatwg.org/#http-origin)
- IETF：[RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455)（Cookie 握手、Origin 校验）、[RFC 6265](https://datatracker.ietf.org/doc/html/rfc6265)、[rfc6265bis-15 SameSite](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-15)
