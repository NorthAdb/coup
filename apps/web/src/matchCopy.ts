import type { CharacterId, SeatView } from "@coup/protocol";

export const CHARACTER_LABEL: Record<CharacterId, string> = {
  duke: "公爵",
  assassin: "刺客",
  captain: "队长",
  ambassador: "大使",
  contessa: "伯爵夫人",
};

export const ACTION_LABEL: Record<string, string> = {
  income: "收入",
  foreign_aid: "外援",
  coup: "政变",
  tax: "征税",
  assassinate: "刺杀",
  steal: "偷窃",
  exchange: "交换",
};

export const ROLE_CARD: Record<
  CharacterId,
  { icon: string; tint: string; hint: string }
> = {
  duke: {
    icon: "♜",
    tint: "rgba(82, 116, 153, 0.62)",
    hint: "征税 · 阻挡外援",
  },
  assassin: {
    icon: "♟",
    tint: "rgba(154, 72, 78, 0.62)",
    hint: "刺杀",
  },
  captain: {
    icon: "♝",
    tint: "rgba(72, 118, 106, 0.62)",
    hint: "偷窃 · 阻挡偷窃",
  },
  ambassador: {
    icon: "♛",
    tint: "rgba(120, 98, 64, 0.62)",
    hint: "交换 · 阻挡偷窃",
  },
  contessa: {
    icon: "♞",
    tint: "rgba(112, 83, 133, 0.64)",
    hint: "阻挡刺杀",
  },
};

export function eventText(
  event: SeatView["projectedHistory"][number],
  seats: SeatView["publicState"]["seats"],
): string {
  const name = (seatId: string) =>
    seats.find((seat) => seat.seatId === seatId)?.displayName ?? seatId;

  switch (event.type) {
    case "match_started":
      return "对局开始";
    case "action_declared": {
      const target =
        event.targetSeatId != null ? ` → ${name(event.targetSeatId)}` : "";
      return `${name(event.seatId)} 声明${ACTION_LABEL[event.actionType] ?? event.actionType}${target}`;
    }
    case "action_resolved": {
      if (event.actionType === "coup" && event.targetSeatId) {
        return `${name(event.seatId)} 政变命中 ${name(event.targetSeatId)}`;
      }
      if (event.actionType === "assassinate" && event.targetSeatId) {
        return `${name(event.seatId)} 刺杀命中 ${name(event.targetSeatId)}`;
      }
      if (event.actionType === "steal" && event.coinsStolen != null) {
        return `${name(event.seatId)} 偷走 ${event.coinsStolen} 枚（${name(event.targetSeatId ?? "")}）`;
      }
      if (event.actionType === "exchange") {
        return `${name(event.seatId)} 完成交换`;
      }
      if (event.coinsGained != null) {
        return `${name(event.seatId)} 获得 ${event.coinsGained} 枚钱币`;
      }
      return `${name(event.seatId)} 行动结算`;
    }
    case "action_failed": {
      const why = event.reason === "blocked" ? "被阻挡" : "被质疑推翻";
      return `${name(event.seatId)} 的${ACTION_LABEL[event.actionType] ?? event.actionType}${why}`;
    }
    case "block_declared":
      return `${name(event.seatId)} 声明阻挡（${CHARACTER_LABEL[event.claimedCharacter] ?? event.claimedCharacter}）`;
    case "response_passed":
      return `${name(event.seatId)} 放弃${event.responseType === "block" ? "阻挡" : "质疑"}`;
    case "challenge_declared":
      return `${name(event.seatId)} 质疑 ${name(event.againstSeatId)}`;
    case "claim_proven":
      return `${name(event.seatId)} 证明了 ${CHARACTER_LABEL[event.character] ?? event.character}`;
    case "claim_conceded":
      return `${name(event.seatId)} 放弃证明`;
    case "influence_revealed":
      return `${name(event.seatId)} 揭示 ${CHARACTER_LABEL[event.character] ?? event.character}`;
    case "seat_eliminated":
      return `${name(event.seatId)} 被淘汰`;
    case "match_finished":
      return `${name(event.winnerSeatId)} 获胜`;
    case "turn_advanced":
      return `轮到 ${name(event.seatId)}`;
    default:
      return "事件";
  }
}

export function controllerLabel(controller: string): string {
  return controller === "local_human" ? "本地人类" : "Agent";
}

export function phaseHint(phase: SeatView["publicState"]["phase"]): string {
  switch (phase) {
    case "await_action_challenge":
      return "可质疑此次角色声明";
    case "await_block":
      return "可声明阻挡或放弃";
    case "await_block_challenge":
      return "可质疑此次阻挡";
    case "await_claim_defense":
      return "证明或放弃证明";
    case "await_influence_reveal":
      return "选择失去的影响力";
    case "await_exchange_selection":
      return "选择归还宫廷的两张牌";
    default:
      return "请响应";
  }
}
