# 核验 Windows 局域网监听、本机 IP 与防火墙准入

Type: research
Mode: AFK
Status: resolved
Blocked by: none

## Question

在 Windows 10/11 上，Node/Fastify 服务要从「仅 loopback」变为可被同局域网浏览器访问时：应如何选择 listen 地址（如 `0.0.0.0` vs 特定网卡 IP）、如何枚举可写入加入链接的本机局域网 IPv4、以及 Windows Defender 防火墙需要哪些准入（应用/端口/专用网络配置文件）才能让客人机稳定连上？哪些做法是官方或一手文档支持的，哪些只是民间经验？

## Answer

主机模式应显式 `listen` 到 `0.0.0.0`（本仓库今日仅 `127.0.0.1`；Fastify 默认 `localhost` 也不行）；加入链接写 `os.networkInterfaces()` / `Get-NetIPAddress` 滤出的非 loopback Preferred IPv4（多网卡默认选谁仍是产品题）。防火墙保持开启，优先为宿主 exe 开 **Private** 入站（优于开端口），建议 `LocalSubnet`；并确认网络分类为 Private，否则 Private 规则不生效。详见 [research/windows-lan-bind-and-firewall.md](../research/windows-lan-bind-and-firewall.md)。
