# 11 — 多 Origin 会话与座位凭证占座

**What to build:** 按各客户端实际入口 Origin 建立会话与 CSRF 防护，废除「单一 loopback 会话 = 唯一人类」假设。座位 1 固定为主机本地人类；客人可占开放人类座位、修改显示名，并获得绑定房间+座位的座位凭证（HttpOnly Cookie 为主）。同机双浏览器（主机用 LAN Origin、客人用同一或另一入口）能看到彼此的占座状态。

**Blocked by:** 10 — 主机模式监听与房间邀请

**Status:** resolved

- [x] 精确 Origin 允许列表覆盖实际入口；进程会话 Cookie 与座位凭证分离
- [x] 客人占座成功后持有可回席的座位凭证；凭证绑定房间+座位，服务端存哈希
- [x] 座位 1 为本地人类；开放槽可被远程人类占座并改显示名
- [x] 同机双浏览器 + LAN Origin 下双方大厅状态可见占座结果

## Answer

多 Origin 会话与座位凭证占座垂直切片：

- `GET /api/session`：按监听端口 + LAN/loopback 入口构建精确 Origin 允许列表；签发进程会话 Cookie（`coup_session`，HttpOnly/`SameSite=Strict`）与 CSRF；拒绝外站 Origin。
- 建房/占座/改名要求会话 + `X-CSRF-Token`；座位凭证 Cookie（`coup_seat`）与会话分离，服务端只存 SHA-256 哈希并绑定房间+座位。
- 建房后座 1 = 本地人类（显示名「你」）并在 **LAN Origin** 上签发座位凭证；座 2–6 默认开放；占座者可改己名；`GET .../me` 凭凭证认回且不暴露哈希。
- 网页薄接线：进主机后先导航到 LAN Origin 再建房（避免座位 Cookie 落在 loopback）；大厅座位列表、占座/改名、跨 Origin 加入导航；大厅轮询可见双方占座。

留给 12：指挥台配置（Agent/关闭）与开局门禁；留给 13：离席宽限与回席轮换。
