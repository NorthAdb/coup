# Brass: Birmingham 联机版 — 规格

> 2026-08-30。数据来源标记：[R] 官方规则书 PDF（boardgame.bg 镜像，Roxley 2018 living document）、
> [T] ikegami/tts_brass 官方扫描 TTS 脚本（lib/App/Birmingham.ttslua）、
> [N] npow/brass-birmingham、[Q] Quasrain-Coder/BrassBirmingham（docs/rules-reference.md）。
> 所有数值经至少两源交叉验证；冲突处以 [T] 为准（详见 research/ 目录与 §冲突记录）。

## 0. 目标与范围

- 网页联机 2–4 人《Brass: Birmingham》，规则正确优先，完整跑通开局→运河末计分→铁路→终局。
- 与现有 Coup 同仓库、同部署单元（apps/web + apps/server），coup 零改动。
- 模块化：规则引擎独立包（无 IO），协议独立包，服务器房间层复用共享基建（session/CSRF/房间码/心跳/离席/清扫），前端独立样式主题。

## 1. 组件与数值（引擎常量，全部已验证）

### 1.1 产业瓦片（每名玩家 45 块 [R p.1][T][N][Q 三方一致]）

flip 方式：cotton/manufacturer/pottery 由 Sell 翻面；coal/iron/brewery 最后 1 个资源被取走时翻面。
`beers`=Sell 需啤酒数；`income`=翻面时收入轨前进格数；`vp`=翻面后时代末得分；`link`=翻面瓦片上的连接图标数（Link 计分）；`bulb`=灯泡不可 Develop；canal-only=铁路时代禁建；rail-only=运河时代禁建。

| industry | lvl | 数量 | 成本 | 产出 | beers | vp | income | link | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| cotton | 1 | 3 | £12 | - | 1 | 5 | 5 | 1 | canal-only |
| cotton | 2 | 2 | £14+1煤 | - | 1 | 5 | 4 | 2 | |
| cotton | 3 | 3 | £16+1煤1铁 | - | 1 | 9 | 3 | 1 | |
| cotton | 4 | 3 | £18+1煤1铁 | - | 1 | 12 | 2 | 1 | |
| manufacturer | 1 | 1 | £8+1煤 | - | 1 | 3 | 5 | 2 | canal-only |
| manufacturer | 2 | 2 | £10+1铁 | - | 1 | 5 | 1 | 1 | |
| manufacturer | 3 | 1 | £12+2煤 | - | 0 | 4 | 4 | 0 | |
| manufacturer | 4 | 1 | £8+1铁 | - | 1 | 3 | 6 | 1 | |
| manufacturer | 5 | 2 | £16+1煤 | - | 2 | 8 | 2 | 2 | |
| manufacturer | 6 | 1 | £20 | - | 1 | 7 | 6 | 1 | |
| manufacturer | 7 | 1 | £16+1煤1铁 | - | 0 | 9 | 4 | 0 | |
| manufacturer | 8 | 2 | £20+2铁 | - | 1 | 11 | 1 | 1 | |
| pottery | 1 | 1 | £17+1铁 | - | 1 | 10 | 5 | 1 | 灯泡 |
| pottery | 2 | 1 | £0+1煤 | - | 1 | 1 | 1 | 1 | |
| pottery | 3 | 1 | £22+2煤 | - | 2 | 11 | 5 | 1 | 灯泡 |
| pottery | 4 | 1 | £0+1煤 | - | 1 | 1 | 1 | 1 | |
| pottery | 5 | 1 | £24+2煤 | - | 2 | 20 | 5 | 1 | rail-only |
| coal | 1 | 1 | £5 | 2煤 | - | 1 | 4 | 2 | canal-only |
| coal | 2 | 2 | £7 | 3煤 | - | 2 | 7 | 1 | |
| coal | 3 | 2 | £8+1铁 | 4煤 | - | 3 | 6 | 1 | |
| coal | 4 | 2 | £10+1铁 | 5煤 | - | 4 | 5 | 1 | |
| iron | 1 | 1 | £5+1煤 | 4铁 | - | 3 | 3 | 1 | canal-only |
| iron | 2 | 1 | £7+1煤 | 4铁 | - | 5 | 3 | 1 | |
| iron | 3 | 1 | £9+1煤 | 5铁 | - | 7 | 2 | 1 | |
| iron | 4 | 1 | £12+1煤 | 6铁 | - | 9 | 1 | 1 | |
| brewery | 1 | 2 | £5+1铁 | 1桶(运河)/2桶(铁路) | - | 4 | 4 | 2 | canal-only |
| brewery | 2 | 2 | £7+1铁 | 同上 | - | 5 | 5 | 2 | |
| brewery | 3 | 2 | £9+1铁 | 同上 | - | 7 | 5 | 2 | |
| brewery | 4 | 1 | £9+1铁 | 同上 | - | 10 | 5 | 2 | rail-only |

### 1.2 地图（20 地点 + 2 农场酒厂 + 5 商人位；槽位 [N]==[Q] 完全一致）

槽位格式：每槽允许的产业（先单图标槽后共享槽放置）。

| 地点 | 槽位 |
|---|---|
| Belper | [cotton,manufacturer] [coal] [pottery] |
| Derby | [cotton,brewery] [cotton,manufacturer] [iron] |
| Leek | [cotton,manufacturer] [cotton,coal] |
| Stoke-on-Trent | [cotton,manufacturer] [pottery,iron] [manufacturer] |
| Stone | [cotton,brewery] [manufacturer,coal] |
| Uttoxeter | [manufacturer,brewery] [cotton,brewery] |
| Stafford | [manufacturer,brewery] [pottery] |
| Burton-on-Trent | [manufacturer,coal] [brewery] |
| Cannock | [manufacturer,coal] [coal] |
| Tamworth | [cotton,coal] [cotton,coal] |
| Walsall | [iron,manufacturer] [manufacturer,brewery] |
| Wolverhampton | [manufacturer] [manufacturer,coal] |
| Coalbrookdale | [iron,brewery] [iron] [coal] |
| Dudley | [coal] [iron] |
| Kidderminster | [cotton,coal] [cotton] |
| Worcester | [cotton] [cotton] |
| Birmingham | [cotton,manufacturer] [manufacturer] [iron] [manufacturer] |
| Coventry | [pottery] [manufacturer,coal] [iron,manufacturer] |
| Nuneaton | [manufacturer,brewery] [cotton,coal] |
| Redditch | [manufacturer,coal] [iron] |
| 农场酒厂×2 | [brewery] ×1（北：Cannock 旁；南：Kidderminster–Worcester 线上） |

### 1.3 连接边 39 条 [T]==[N]，Canal=运河可用，Rail=铁路可用

仅铁路（8）：Belper–Leek, Birmingham–Nuneaton, Birmingham–Redditch, Burton–Cannock, Coventry–Nuneaton, Derby–Uttoxeter, Stone–Uttoxeter, Tamworth–Walsall。
仅运河（1）：Burton–Walsall。其余 30 条两用。
三端点边：Kidderminster–(南农场)–Worcester 单条 Link 同时连接三者（计分时三地都算相邻）。
商人位边：Birmingham–Oxford, Redditch–Oxford, Coalbrookdale–Shrewsbury, Derby–Nottingham, Gloucester–Redditch, Gloucester–Worcester, Stoke-on-Trent–Warrington。

### 1.4 商人位（5 个外部地点）

| 商人 | 板位 | 入场人数 | 啤酒奖励（喝该板旁啤酒时获得） |
|---|---|---|---|
| Shrewsbury | 1 | 2/3/4p | +4 VP |
| Gloucester | 2 | 2/3/4p | 免费 Develop 1 块（移除面板任意产业最低级 1 块，不耗铁；灯泡陶除外） |
| Oxford | 2 | 2/3/4p | 收入轨 +2 格 |
| Warrington | 2 | 3/4p | +£5 |
| Nottingham | 2 | 4p | +3 VP |

- 商人板块（tile）共 9 块 [T]：万能(收棉+制造+陶)×1、棉×2、制造×2、陶×1、空白×3。
  入场：2p 用 5 块 {万能,棉,制造,空白×2}；3p 7 块（+陶、+空白）；4p 9 块全用。洗混随机放到可用板位（Shrewsbury→Warrington→Nottingham→Gloucester→Oxford 顺序，2p 空 Warrington/Nottingham，3p 空 Nottingham）。
  空白板不收货、旁不放啤酒桶。商人板本身无收入/VP 数值（与 Lancashire 不同）。
- 商人位是煤市场购买连通图标（无需板上有板块）；煤矿建成卖市场需连通任一商人位（含空位）。
- 每个非空白商人板块旁 1 个啤酒格，设置放 1 桶，时代切换补满空位。

### 1.5 市场

- 煤市场 14 格：£1×2,£2×2,£3×2,£4×2,£5×2,£6×2,£7×2；设置 13 块（留 1 个 £1 空）；买空后兜底 £8/块。
- 铁市场 10 格：£1×2..£5×2；设置 8 块（留 2 个 £1 空）；买空后 £6/块。
- 买：从最便宜有块格取，按格价付钱。卖（仅建成当次行动）：从最贵空格填，按格价收钱；煤卖需连通商人位，铁无条件。

### 1.6 收入轨（0–99 格；等级 −10..30）

格 0–10=等级 −10..0（每级 1 格）；11–30=+1..+10（每级 2 格）；31–60=+11..+20（每级 3 格）；61–96=+21..+29（每级 4 格）；97–99=+30。
起始格 10（等级 0）。收入增加按格前进，上限等级 30。贷款退 3 个等级（不是格）落到新等级最高格，等级不得低于 −10。

### 1.7 牌组 [N 逐卡明细；总量经 40/54/64 ↔ 每时代 10/9/8 回合 ×人数×2行动 精确验证]

以 minPlayers 标注（4p 全量 64 张）：地点卡 41（birmingham3, coventry3, coalbrookdale3, derby3(min4), stoke3(min3), belper2(min4), leek2(min3), stone2(min3), uttoxeter1(min4)+1(min3), stafford2, burton2, cannock2, dudley2, kidderminster2, wolverhampton2, worcester2, tamworth1, walsall1, nuneaton1, redditch1）；
产业卡：iron4(min2), coal2(min2)+coal1(min4), pottery2(min2)+pottery1(min4), brewery5(min2), 双图标 cotton|manufacturer 6(min3)+2(min4)。
Wild：4 Wild Location + 4 Wild Industry，不进牌堆（面朝上放抽牌区，Scout 获取；弃置回抽牌区）。

### 1.8 设置 [R p.4]

每人 £17、收入格 10、VP 0；抽 8 张手牌 + 1 张面朝下弃牌堆底；随机座次。煤/铁市场如上；商人板块按人数；Warrington/Nottingham 板位按人数留空（2p 均空，3p 空 Nottingham）。

## 2. 回合流程 [R p.6]

- 每时代固定回合（标准流 4/3/2p = 8/9/10 回合）；每回合按座次各 1 回合，每回合 2 个行动；**运河时代第 1 回合每人 1 个行动**。
- 每个行动必须弃 1 张手牌（Scout 弃 3；Pass 也弃 1；Wild 弃置回抽牌区不进弃牌堆）。
- 回合结束：从牌库补手牌至 8；本回合花费记到角色块（决定下轮座次）。
- 回合全部结束后：下轮座次=本轮花费升序（并列保持相对序）；收取收入（=当前收入等级，负数则支付；不足支付→半价向下取整拆场上自己板块至够付，仍不足→每差 £1 扣 1 VP）；**游戏最终回合不收收入**。
- 牌库空后手牌不再补充；时代在「某回合所有人都用完手牌」后结束。

## 3. 行动细则 [R p.6,9–11]

### Build
- 唯一需特定卡的行动：地点卡→该地点任意产业（不要求联网）；Wild Location→任意地点卡（农场酒厂除外）；产业卡→自己 network 内地点建对应产业（双图标二选一）；Wild Industry→任意产业卡（可建农场酒厂）。
- 放面板该产业**最低级**板块到匹配空槽（先单图标槽）；无匹配空槽→只能 Overbuild。
- 支付 £ + 消耗煤/铁。**煤**：建造地点须连通煤源=最近连通未翻面煤矿（任何玩家，免费；并列任选；不够取次近）；否则市场购买（需连通任一商人位图标；市场空仍可 £8/块）。无任何来源→不可建。
- **铁**：任意未翻面铁厂（无需连通，可混源），否则市场（£6 兜底，无需连通）。
- 建成：煤矿放煤块/铁厂放铁块/酒厂放桶（运河 1 桶、铁路 2 桶）；煤矿（连通任一商人位时）或铁厂（无条件）立即尽量向市场卖块（最贵空格先填）收钱；卖空→翻面+收入前进。
- 运河时代：每地点最多 1 块自己的板块；canal-only 等级不可在铁路时代建（rail-only 同理禁于运河时代）。铁路时代：地点内不限块数。
- 自己场上无板块且无 Link 时：产业卡可在任意有匹配空槽的地点建；任意卡可在任意空线放 Link。

### Overbuild
- 同产业更高级板块替换已放置板块（照常付费耗资源）；放的还是面板最低级板块，须高于被替换板块等级。
- 自己的：任意产业可覆盖；被覆盖板块资源退回公共供应。
- 对手的：仅煤/铁厂；且全版图+市场该类方块总数为 0。
- 被覆盖板块移出游戏不计分；已得收入/VP 不收回。

### Network
- 新 Link 须相邻己方 network 地点（无任何场上板块时可放任意空线）。
- 运河时代：1 条运河 Link £3（只能运河线）。铁路时代：1 条 £5；或 2 条 £15 + 消耗 1 啤酒（必须酒厂：自己任意/对手的须与第二条放置后连通；不可用商人啤酒）；每条铁路各耗 1 煤（逐条放置逐条检查）。

### Develop
- 移除面板 1–2 块当前最低级板块（可不同产业）；每块耗 1 铁。灯泡陶（P1/P3）不可 Develop。

### Sell
- 弃任意卡；可连续卖多块（棉/制造/陶混合）：每块须连通到收该货的商人板块（空白板不收；万能板收全部）；消耗瓦片右上啤酒数；啤酒来源：①自己未翻面酒厂（全图任意）②对手未翻面酒厂（须与该瓦片所在地点连通）③所卖向商人板块旁啤酒（可选，用了得该商人奖励）。
- 无法凑齐啤酒→整次 Sell 不可执行。翻面+收入前进。喝 Gloucester 板啤酒→免费 Develop（命令中预声明目标产业，引擎校验）。

### Loan：+£30，收入等级 −3 落最高格，不低于 −10。
### Scout：弃 3 张→拿 Wild Location + Wild Industry 各 1；手中有 Wild 不可执行。
### Pass：弃 1 张不做事。

## 4. 时代切换与计分 [R p.7]

- 时代末流程：①Link 计分：每条自己 Link，其相邻地点（商人位恒 2；其余=该地已翻面瓦片的连接图标数之和）每图标 1 VP，计分后移除 Link；②翻面产业计分：自己的已翻面板块按 vp 计分（未翻面 0 分）。
- 运河时代末追加：③移除场上全部 1 级板块（面板不移除）；④补满商人啤酒空位；⑤弃牌堆洗成新牌库；⑥每人重抽 8 张。
- 终局：总分高者胜；平局比收入等级→现金→仍平共胜。钱与收入不折算 VP。
- 连接定义：两地点连通=任一玩家的 Link 链可达；network=含自己板块的地点 ∪ 与自己 Link 相邻的地点。
- 煤距离：以消耗地为起点在 Link 图上 BFS 的跳数。

## 5. 架构方案

```
packages/brass-domain   纯引擎：data/（board/tiles/cards/markets/income）、state、actions（校验+执行）、
                        autoPlan、projectForSeat、随机 playout 测试
packages/brass-protocol SeatView/SeatDecision DTO（房间层类型亦收编于此，避免三份漂移副本）
apps/server/src/brass/  平行房间栈：roomRegistry、matchRuntime、persist（sqlite brass_rooms/brass_matches）、
                        路由 /api/brass/*；复用 sessionAuth/roomInvite 码池/心跳离席/清扫
apps/web/src/brass/     页面：Portal（首页游戏选择，重设计）、大厅、桌面（SVG 地图+玩家面板+市场+手牌）
```

- 命令模型：**原子复合命令**（一次提交整行动作的完整参数），引擎全量校验、乐观并发 expectedVersion；UI 可行项由 domain 导出的 helper 枚举（legalBuildTargets 等）。
- 超时代打：planAutoDecision=Pass（弃手牌第一张）；缺度时由 server armTurnTimer 同 coup 模式。
- 观战：同 coup 投影剥离私有态。
- 首页 `/` 门户；`/coup/*` 现有流程（旧 /join 301 兼容）；`/brass/*` 新流程。coup 样式零改动，brass 用独立 brass.css。

## 6. 冲突记录（研究期裁决）

1. 商人板块构成：[T] 2p{万能,棉,制造,空白×2} +3p{陶,空白} +4p{棉,制造}；[N] 有误不采。
2. 逐卡明细 [N] 单一来源，40/54/64 总量经回合数精确验证，高置信采用。
3. 连线计分：相邻商人位恒 2（[T] bonuses_by_external_location + [Q] 板图目视），地点=已翻面瓦片连接图标之和（[T] get_value_of_location_for_link 逻辑 + [R] 规则书图示）。
4. 时代结束由牌+手牌耗尽触发（Birmingham 特性），非 Link 用尽（Lancashire 特性）；Link 每人 14 块/时代（瓦片双面运河/铁路）。
5. 制造 IV 成本 £8+1铁（[Q] 勘误 + [T][N] 一致）。
