import type { BrassState, IndustryType, LogEntry } from "@coup/brass-domain";
import { LOCATIONS, MERCHANTS, LINKS } from "@coup/brass-domain";

export const INDUSTRY_LABEL: Record<IndustryType, string> = {
  cotton: "棉纺厂",
  manufacturer: "制造厂",
  pottery: "陶瓷厂",
  coal: "煤矿",
  iron: "铁厂",
  brewery: "酿酒厂",
};

export const INDUSTRY_SHORT: Record<IndustryType, string> = {
  cotton: "棉",
  manufacturer: "制造",
  pottery: "陶",
  coal: "煤",
  iron: "铁",
  brewery: "酿",
};

export const INDUSTRY_COLOR: Record<IndustryType, string> = {
  cotton: "#c9a227",
  manufacturer: "#8c6239",
  pottery: "#a34a3f",
  coal: "#3d3a35",
  iron: "#b05f2c",
  brewery: "#d08a2e",
};

/** 手牌/面板产业字块：底色 + 字色（与瓦片观感一致，保证小尺寸可读）。 */
export const INDUSTRY_CHIP: Record<IndustryType, { color: string; ink: string }> = {
  cotton: { color: "#d99a5b", ink: "#3a2510" },
  manufacturer: { color: "#8a6fae", ink: "#f3ecdc" },
  pottery: { color: "#4e9a8a", ink: "#0e2924" },
  coal: { color: "#45413a", ink: "#e8dfc8" },
  iron: { color: "#b3572d", ink: "#fbe9d8" },
  brewery: { color: "#b08d57", ink: "#33230f" },
};

export function locationLabel(id: string): string {
  if (LOCATIONS[id]) return LOCATIONS[id].name;
  if (MERCHANTS[id]) return MERCHANTS[id].name;
  return id;
}

export function merchantBonusLabel(location: string): string {
  const bonus = MERCHANTS[location]?.bonus;
  if (!bonus) return "";
  switch (bonus.type) {
    case "vp":
      return `+${bonus.amount} 分`;
    case "money":
      return `+£${bonus.amount}`;
    case "income":
      return `收入 +${bonus.amount} 格`;
    case "develop":
      return "免费研发";
    default:
      return "";
  }
}

export function linkLabel(linkIndex: number): string {
  const def = LINKS[linkIndex];
  if (!def) return "";
  return `${locationLabel(def.a)}—${def.via ? `${locationLabel(def.via)}—` : ""}${locationLabel(def.b)}`;
}

export function cardLabel(cardId: string): string {
  if (cardId === "wild-location") return "万能地点";
  if (cardId === "wild-industry") return "万能产业";
  const base = cardId.slice(0, cardId.lastIndexOf("#") >= 0 ? cardId.lastIndexOf("#") : undefined);
  if (base.startsWith("loc-")) return `地点：${locationLabel(base.slice(4))}`;
  if (base.startsWith("ind-")) {
    const inds = base.slice(4).split("_").map((i) => INDUSTRY_SHORT[i as IndustryType] ?? i);
    return `产业：${inds.join("/")}`;
  }
  return cardId;
}

export function resourceLabel(kind: string): string {
  switch (kind) {
    case "coal":
      return "煤";
    case "iron":
      return "铁";
    case "beer":
      return "啤酒";
    default:
      return kind;
  }
}

/** 对局日志 → 中文短句。 */
export function logText(entry: LogEntry, selfPlayer: number | null): string {
  const who = entry.player !== undefined ? playerName(entry.player, selfPlayer) : "";
  const p = entry.payload ?? {};
  switch (entry.kind) {
    case "build":
      return `${who} 在${locationLabel(String(p.location))}建造 ${INDUSTRY_LABEL[p.industry as IndustryType]} ${roman(Number(p.level))}${p.overbuilt ? "（覆盖）" : ""}`;
    case "overbuild":
      return `${who} 覆盖了${locationLabel(String(p.location))}的 ${INDUSTRY_LABEL[p.industry as IndustryType]}（${playerName(Number(p.replacedOwner), selfPlayer)}）`;
    case "network":
      return `${who} 铺设连线 ×${String(p.links).split(",").length}（£${p.money}）`;
    case "develop":
      return `${who} 研发移除 ${String(p.removed).split(",").join("、")}`;
    case "sell":
      return `${who} 将 ${INDUSTRY_LABEL[p.industry as IndustryType]} ${roman(Number(p.level))} 卖向${locationLabel(String(p.merchant).split("#")[0])}`;
    case "loan":
      return `${who} 贷款 £30（收入降至 ${p.newLevel}）`;
    case "scout":
      return `${who} 侦察，获得双万能卡`;
    case "pass":
      return `${who} 跳过行动`;
    case "flip":
      return `${who} 的 ${INDUSTRY_LABEL[p.industry as IndustryType]} ${roman(Number(p.level))} 翻面（收入 +${p.income}）`;
    case "market_sell":
      return `${who} 向${p.resource === "coal" ? "煤" : "铁"}市场出售 ${p.cubes} 块（£${p.revenue}）`;
    case "merchant_bonus":
      return `${who} 获得商人奖励（${locationLabel(String(p.merchant))}：${merchantBonusLabel(String(p.merchant))}）`;
    case "income":
      return `${who} 收取收入 ${Number(p.gained) >= 0 ? `£${p.gained}` : `−£${Math.abs(Number(p.gained))}`}（等级 ${p.level}）`;
    case "shortfall":
      if (p.stage === "enter") return `${who} 无法支付缺额 £${p.amount}，需拆除板块`;
      if (p.stage === "remove") return `${who} 拆除板块换得 £${p.value}`;
      if (p.stage === "paid") return `${who} 补足缺额 £${p.amount}`;
      return `${who} 无板块可拆，损失 ${p.vp} 分`;
    case "era_score":
      return `${who} ${p.source === "links" ? "连线" : "翻面产业"}计分 +${p.vp} 分`;
    case "era_end":
      if (p.stage === "rail_era_start") return "—— 铁路时代开始 ——";
      if (p.stage === "game_end") return "—— 对局结束 ——";
      return `清除 ${p.removed} 块 1 级板块`;
    case "game_end":
      return p.winners !== undefined && String(p.winners).length > 0 ? `胜者：${String(p.winners).split(",").map((w) => playerName(Number(w), selfPlayer)).join("、")}` : "对局结束";
    default:
      return entry.kind;
  }
}

function playerName(player: number, selfPlayer: number | null): string {
  return player === selfPlayer ? "你" : `P${player + 1}`;
}

export function roman(level: number): string {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"][level] ?? String(level);
}

/** 服务端错误码 → 中文提示。 */
export function errorText(error: unknown): string {
  const code = (error as { code?: string }).code ?? (error instanceof Error ? error.message : "");
  const map: Record<string, string> = {
    version_mismatch: "状态已更新，请刷新后重试",
    not_your_turn: "还没有轮到你",
    card_not_in_hand: "手牌不存在，请刷新",
    slot_mismatch: "该位置不能建此产业",
    slot_occupied: "该位置已被占用",
    dedicated_slot_required: "存在专属空位，必须放专属位",
    canal_one_tile_per_location: "运河时代每个地点限建 1 块",
    canal_only_tile: "该等级板块铁路时代不可建",
    rail_only_tile: "该等级板块运河时代不可建",
    location_not_in_network: "该地点不在你的网络内（产业卡要求）",
    coal_market_not_connected: "买煤需连通任意商人位",
    connected_mine_exists: "有连通煤矿时必须用煤矿的煤",
    closer_coal_available: "必须先用更近的煤矿",
    coal_source_not_connected: "该煤矿与建造地点不连通",
    coal_source_empty: "该煤矿已无煤",
    iron_works_exist: "场上有未翻面铁厂时必须用铁厂",
    coal_count_mismatch: "煤的数量不符",
    iron_count_mismatch: "铁的数量不符",
    beer_count_mismatch: "啤酒数量不符",
    beer_brewery_not_connected: "对手酒厂须与用酒处连通",
    merchant_not_connected: "未连通该商人位",
    merchant_does_not_accept: "该商人板不收此货物",
    merchant_beer_unavailable: "该商人板旁没有啤酒",
    gloucester_develop_required: "使用 Gloucester 商人啤酒需选择免费研发目标",
    no_tile_on_mat: "面板上没有对应产业板块",
    lightbulb_cannot_develop: "灯泡陶不可研发",
    insufficient_money: "资金不足",
    loan_below_min: "贷款将使收入低于 −10",
    scout_with_wild: "手中有万能卡时不能侦察",
    no_wild_cards: "万能卡已被取完",
    link_not_adjacent_to_network: "连线必须相邻你的网络",
    link_occupied: "该连线已铺设",
    not_a_canal_line: "运河时代只能铺运河线",
    not_a_rail_line: "铁路时代只能铺铁路线",
    rail_link_count: "铁路时代每次铺 1 或 2 条",
    double_rail_needs_beer: "双轨需要消耗 1 桶啤酒",
    no_links_left: "你的连线板块已用完",
    sell_empty: "至少选择一块要卖的瓦片",
    not_sellable: "该产业不能出售",
    overbuild_not_higher: "覆盖必须用更高级瓦片",
    overbuild_opponent_limited: "只能覆盖对手的煤/铁厂",
    overbuild_resource_exists: "全图该资源清零后才能覆盖对手",
    overbuild_industry_mismatch: "覆盖必须同产业",
    overbuild_location_mismatch: "覆盖目标不在该地点",
    phase_shortfall: "当前有玩家正在处理缺额",
    no_actions_left: "本回合行动已用完",
    match_finished: "对局已结束",
    farm_needs_brewery_card: "农场酒厂只能用啤酒产业卡或万能产业卡",
    card_location_mismatch: "地点卡与目标地点不符",
    card_industry_mismatch: "产业卡与所选产业不符",
    room_not_found: "房间不存在",
    no_active_match: "当前没有进行中的对局",
    seat_absent: "你已被标记离席，请先回席",
    seat_not_open: "该座位已被占用",
    host_seat_required: "需要房主身份",
    need_host_mode: "请房主先创建房间",
    room_capacity_reached: "房间已满",
    room_not_lobby: "房间不在大厅阶段",
    seat_credential_required: "需要座位凭证，请先就座",
    seat_not_remote: "该座位不是你的",
    open_seats_remain: "还有未就座的空位",
    too_few_seats: "至少需要 2 名玩家",
    seats_not_confirmed: "还有玩家未确认续局",
  };
  return map[code] ?? `操作失败（${code || "未知错误"}）`;
}

/** 手牌排序：地点卡在前，产业卡在后。 */
export function handOrder(state: BrassState, hand: string[]): string[] {
  return hand.slice().sort((a, b) => cardSortKey(a) - cardSortKey(b));
}

function cardSortKey(cardId: string): number {
  if (cardId === "wild-location") return 90;
  if (cardId === "wild-industry") return 91;
  const base = cardId.slice(0, cardId.lastIndexOf("#") >= 0 ? cardId.lastIndexOf("#") : undefined);
  if (base.startsWith("loc-")) return 0;
  return 10;
}
