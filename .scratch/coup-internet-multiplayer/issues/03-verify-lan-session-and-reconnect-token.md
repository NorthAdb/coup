# 核验多客户端会话、Origin/CSRF 与座位重连令牌边界

Type: research
Mode: AFK
Status: resolved
Blocked by: none

## Question

对照本仓库当前本机会话模型（精确 Origin、启动期随机会话、HttpOnly/`SameSite=Strict` Cookie、CSRF）与浏览器/Fetch/WebSocket 一手规范：当多名客人通过主机局域网 IP:端口 打开同源页、并需要「座位重连令牌」在刷新后认回座位时，现有 Cookie/Origin 假设哪些仍然成立、哪些必须改？重连令牌更适合做成何种载体与绑定（房间+座位、TTL、轮换）？主机用 `127.0.0.1` 打开与客人用 `192.168.x.x` 打开时的站点边界如何处理？

## Answer

同源 + 精确 Origin + HttpOnly/`SameSite=Strict` + CSRF 在「每个客户端各自打开的那个 URL」内仍成立；必须改的是单一 loopback Origin / 单一本机会话代表唯一人类的假设。`127.0.0.1` 与 `192.168.x.x` 是不同 origin/site，Cookie 与 storage 互不相通——Origin 允许列表须覆盖实际入口，主机宜与客人用同一 LAN URL。座位重连令牌与进程会话 Cookie 分离，绑定房间+座位，高熵/服务端哈希/TTL/成功后轮换；主载体为加入 Origin 上的独立 HttpOnly Cookie。详见 [研究报告](../research/lan-session-and-reconnect-token.md)。
