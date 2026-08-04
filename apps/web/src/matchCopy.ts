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

export type TextPart =
  | { type: "text"; text: string }
  | { type: "seat"; seatId: string; text: string };

type NamedSeat = { seatId: string; displayName: string };

function seatPart(seats: readonly NamedSeat[], seatId: string): TextPart {
  return {
    type: "seat",
    seatId,
    text: seats.find((seat) => seat.seatId === seatId)?.displayName ?? seatId,
  };
}

export function joinTextParts(parts: readonly TextPart[]): string {
  return parts.map((part) => part.text).join("");
}

/** Public event copy as text/seat segments for seat-color rendering. */
export function eventParts(
  event: SeatView["projectedHistory"][number],
  seats: readonly NamedSeat[],
): TextPart[] {
  const seat = (seatId: string) => seatPart(seats, seatId);
  const text = (value: string): TextPart => ({ type: "text", text: value });

  switch (event.type) {
    case "match_started":
      return [text("对局开始")];
    case "action_declared": {
      const parts: TextPart[] = [
        seat(event.seatId),
        text(` 声明${ACTION_LABEL[event.actionType] ?? event.actionType}`),
      ];
      if (event.targetSeatId != null) {
        parts.push(text(" → "), seat(event.targetSeatId));
      }
      return parts;
    }
    case "action_resolved": {
      if (event.actionType === "coup" && event.targetSeatId) {
        return [
          seat(event.seatId),
          text(" 政变命中 "),
          seat(event.targetSeatId),
        ];
      }
      if (event.actionType === "assassinate" && event.targetSeatId) {
        return [
          seat(event.seatId),
          text(" 刺杀命中 "),
          seat(event.targetSeatId),
        ];
      }
      if (event.actionType === "steal" && event.coinsStolen != null) {
        return [
          seat(event.seatId),
          text(` 偷走 ${event.coinsStolen} 枚（`),
          seat(event.targetSeatId ?? ""),
          text("）"),
        ];
      }
      if (event.actionType === "exchange") {
        return [seat(event.seatId), text(" 完成交换")];
      }
      if (event.coinsGained != null) {
        return [
          seat(event.seatId),
          text(` 获得 ${event.coinsGained} 枚钱币`),
        ];
      }
      return [seat(event.seatId), text(" 行动结算")];
    }
    case "action_failed": {
      const why = event.reason === "blocked" ? "被阻挡" : "被质疑推翻";
      return [
        seat(event.seatId),
        text(
          ` 的${ACTION_LABEL[event.actionType] ?? event.actionType}${why}`,
        ),
      ];
    }
    case "block_declared":
      return [
        seat(event.seatId),
        text(
          ` 声明阻挡（${CHARACTER_LABEL[event.claimedCharacter] ?? event.claimedCharacter}）`,
        ),
      ];
    case "response_passed":
      return [
        seat(event.seatId),
        text(
          ` 放弃${event.responseType === "block" ? "阻挡" : "质疑"}`,
        ),
      ];
    case "challenge_declared":
      return [
        seat(event.seatId),
        text(" 质疑 "),
        seat(event.againstSeatId),
      ];
    case "claim_proven":
      return [
        seat(event.seatId),
        text(
          ` 证明了 ${CHARACTER_LABEL[event.character] ?? event.character}`,
        ),
      ];
    case "claim_conceded":
      return [seat(event.seatId), text(" 放弃证明")];
    case "influence_revealed":
      return [
        seat(event.seatId),
        text(
          ` 揭示 ${CHARACTER_LABEL[event.character] ?? event.character}`,
        ),
      ];
    case "seat_eliminated":
      return [seat(event.seatId), text(" 被淘汰")];
    case "match_finished":
      return [seat(event.winnerSeatId), text(" 获胜")];
    case "turn_advanced":
      return [text("轮到 "), seat(event.seatId)];
    default:
      return [text("事件")];
  }
}

export type SeatModelLabelInput = {
  controller: string;
  cli: "opencode" | "claude" | "stub" | null;
  modelId: string | null;
};

function shortModelLabel(modelId: string | null): string | null {
  if (modelId == null || modelId.trim().length === 0) return null;
  const trimmed = modelId.trim();
  if (trimmed.endsWith("/placeholder") || trimmed === "placeholder") {
    return "占位";
  }
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function cliDisplayName(cli: "opencode" | "claude" | "stub"): string {
  switch (cli) {
    case "opencode":
      return "OpenCode";
    case "claude":
      return "Claude Code";
    case "stub":
      return "Stub";
  }
}

/** Readable seat-card label for public CLI / model projection. */
export function seatModelLabel(seat: SeatModelLabelInput): string {
  if (seat.controller === "local_human") {
    return "本地人类";
  }
  if (seat.controller === "remote_human") {
    return "远程人类";
  }
  const cli = seat.cli ?? "stub";
  const model = shortModelLabel(seat.modelId) ?? "占位";
  return `${cliDisplayName(cli)} · ${model}`;
}

export type SeatCalloutTone = "default" | "challenge" | "pass";

export type SeatCallout = {
  seatId: string;
  text: string;
  parts: TextPart[];
  tone: SeatCalloutTone;
};

type CalloutSeat = { seatId: string; displayName: string };

function calloutFromParts(
  seatId: string,
  parts: TextPart[],
  tone: SeatCalloutTone = "default",
): SeatCallout {
  return { seatId, parts, text: joinTextParts(parts), tone };
}

/** Short public-decision callout shown beside a seat (no rationale / private info). */
export function seatCalloutFromEvent(
  event: SeatView["projectedHistory"][number],
  seats: readonly CalloutSeat[],
): SeatCallout | null {
  const seat = (seatId: string) => seatPart(seats, seatId);
  const text = (value: string): TextPart => ({ type: "text", text: value });

  switch (event.type) {
    case "action_declared": {
      const action = ACTION_LABEL[event.actionType] ?? event.actionType;
      const parts: TextPart[] = [text(`声明${action}`)];
      if (event.targetSeatId != null) {
        parts.push(text(" → "), seat(event.targetSeatId));
      }
      return calloutFromParts(event.seatId, parts);
    }
    case "block_declared":
      return calloutFromParts(event.seatId, [
        text(
          `阻挡 · ${CHARACTER_LABEL[event.claimedCharacter] ?? event.claimedCharacter}`,
        ),
      ]);
    case "response_passed":
      return calloutFromParts(
        event.seatId,
        [text(`放弃${event.responseType === "block" ? "阻挡" : "质疑"}`)],
        event.responseType === "challenge" ? "pass" : "default",
      );
    case "challenge_declared":
      return calloutFromParts(
        event.seatId,
        [text("质疑 "), seat(event.againstSeatId)],
        "challenge",
      );
    case "claim_proven":
      return calloutFromParts(event.seatId, [
        text(
          `证明${CHARACTER_LABEL[event.character] ?? event.character}`,
        ),
      ]);
    case "claim_conceded":
      return calloutFromParts(event.seatId, [text("放弃证明")]);
    case "influence_revealed":
      return calloutFromParts(event.seatId, [
        text(
          `揭示${CHARACTER_LABEL[event.character] ?? event.character}`,
        ),
      ]);
    case "action_resolved":
      if (event.actionType === "exchange") {
        return calloutFromParts(event.seatId, [text("完成交换")]);
      }
      return null;
    default:
      return null;
  }
}

/** Later callouts for the same seat replace earlier ones (no queue). */
export function seatCalloutsFromEvents(
  events: readonly SeatView["projectedHistory"][number][],
  seats: readonly CalloutSeat[],
): Record<string, SeatCallout> {
  const map: Record<string, SeatCallout> = {};
  for (const event of events) {
    const callout = seatCalloutFromEvent(event, seats);
    if (callout) {
      map[callout.seatId] = callout;
    }
  }
  return map;
}

export type DecisionRationaleView = {
  text: string;
  source: "agent" | "template";
};

export function rationaleSourceLabel(
  source: DecisionRationaleView["source"],
): string {
  return source === "agent" ? "Agent 说明" : "根据决策生成";
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
      return "选择要保留的影响力";
    default:
      return "请响应";
  }
}
