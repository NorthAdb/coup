import type { GemColor, SplendorEvent } from "@coup/splendor-domain";
import type { ApiError } from "../platform/roomApi.js";

/** Splendor 面向用户的中文文案：宝石名、事件日志、错误映射。 */

export const GEM_NAMES: Record<GemColor, string> = {
  white: "钻石",
  blue: "蓝宝石",
  green: "祖母绿",
  red: "红宝石",
  black: "黑曜石",
};

export const GEM_ORDER: GemColor[] = ["white", "blue", "green", "red", "black"];

export const NOBLE_NAMES_CN: Record<string, string> = {
  "Mary Stuart": "玛丽·斯图亚特",
  "Charles V": "查理五世",
  Machiavelli: "马基雅维利",
  "Isabella of Castile": "卡斯蒂利亚的伊莎贝拉",
  "Suleiman the Magnificent": "苏莱曼大帝",
  "Catherine de' Medici": "凯瑟琳·德·美第奇",
  "Anne of Brittany": "布列塔尼的安妮",
  "Henry VIII": "亨利八世",
  "Elisabeth of Austria": "奥地利的伊丽莎白",
  "Francis I of France": "法兰西斯一世",
};

export function nobleName(name: string): string {
  return NOBLE_NAMES_CN[name] ?? name;
}

export function eventText(event: SplendorEvent, displayNames: Record<string, string>, mySeatId: string | null): string {
  const seatName = (player: number) => {
    const seatId = String(player + 1);
    if (seatId === mySeatId) return "你";
    return displayNames[seatId] ?? `${seatId} 号`;
  };
  const gemText = (gems: Record<GemColor, number>) =>
    GEM_ORDER.filter((c) => gems[c] > 0).map((c) => `${GEM_NAMES[c]}×${gems[c]}`).join("、") || "无";
  switch (event.kind) {
    case "match_started":
      return `对局开始（${event.playerCount} 人）`;
    case "gems_taken":
      return `${seatName(event.player)} 拿取了 ${gemText(event.gems)}`;
    case "reserved":
      return `${seatName(event.player)} 预留了 ${event.level} 级${event.fromDeck ? "牌库顶（暗留）" : "明牌"}${event.goldTaken ? "，并得 1 枚黄金" : ""}`;
    case "purchased":
      return `${seatName(event.player)} 购得 ${event.card.level} 级卡（+${event.card.points} 分）${event.goldUsed > 0 ? `，动用黄金 ${event.goldUsed}` : ""}`;
    case "gems_discarded":
      return `${seatName(event.player)} 归还了 ${gemText(event.gems)}`;
    case "noble_visits":
      return `${seatName(event.player)} 迎来 ${nobleName(event.noble.name)} 造访（+3 分）`;
    case "final_round":
      return `${seatName(event.player)} 达到 ${event.points} 分——本轮结束即终局！`;
    case "match_finished": {
      const winners = event.winners.map((p) => seatName(p)).join("、");
      return `终局：${winners} 以最高分胜出`;
    }
    default:
      return "";
  }
}

const ERROR_TEXT: Record<string, string> = {
  session_required: "会话已失效，刷新页面重试",
  csrf_required: "会话校验失败，请刷新页面",
  csrf_invalid: "会话校验失败，请刷新页面",
  origin_not_allowed: "当前地址不在允许列表内",
  room_not_found: "房间不存在或已解散",
  room_capacity_reached: "房间已满，稍后再试",
  hosting_unavailable: "服务器暂未开放建房",
  need_host_mode: "服务器未进入主机模式",
  seat_not_open: "该座位已被占用或关闭",
  seat_credential_required: "需要座位凭证，请先就座",
  seat_credential_mismatch: "座位凭证不匹配",
  seat_absent: "你当前处于离席状态，等待回席",
  no_active_match: "当前没有进行中的对局",
  not_your_turn: "还没轮到你",
  version_mismatch: "对局已更新，请稍候重试",
  unsupported_protocol: "协议版本不匹配，请刷新页面",
  invalid_command: "不合法的操作",
  invalid_gems: "宝石选择不合法：三散或同色两枚",
  pool_insufficient: "公共宝石不足",
  two_same_requires_four: "同色两枚仅当供应区有 4 枚及以上才可拿",
  reserved_limit: "预留已达 3 张上限",
  slot_empty: "该位置没有牌",
  deck_empty: "该级牌库已空",
  insufficient_payment: "宝石不足以支付",
  card_not_reserved: "该卡不在你的预留区",
  not_discarding: "当前无需归还宝石",
  invalid_discard: "归还数量不正确",
  not_choosing_noble: "当前没有贵族待选",
  noble_not_eligible: "该贵族不在可选之列",
  await_discard_pending: "请先归还超额宝石",
  await_noble_pending: "请先选择造访的贵族",
  technical_abort: "对局因技术故障中止",
  persistence_failed: "存档失败，对局已中止",
};

export function errorText(error: unknown): string {
  const code = (error as ApiError)?.code;
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (code) return `操作失败（${code}）`;
  return "网络异常，请稍后重试";
}
