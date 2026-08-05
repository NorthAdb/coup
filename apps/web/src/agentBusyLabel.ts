import type { TextPart } from "./matchCopy.ts";

export type AgentBusyPhase =
  | "idle"
  | "thinking"
  | "validating"
  | "retrying"
  | "failed";

export type BusySeat = {
  seatId: string;
  displayName: string;
};

/** Stage copy naming every Agent seat still owed a decision. */
export function agentBusyParts(
  phase: AgentBusyPhase,
  seats: readonly BusySeat[],
): TextPart[] {
  const verb =
    phase === "validating"
      ? "正在校验决策…"
      : phase === "retrying"
        ? "正在重试…"
        : phase === "failed"
          ? "调用失败"
          : "思考中…";

  if (seats.length === 0) {
    return [{ type: "text", text: `Agent ${verb}` }];
  }

  const parts: TextPart[] = [];
  seats.forEach((seat, index) => {
    if (index > 0) {
      parts.push({ type: "text", text: "、" });
    }
    parts.push({
      type: "seat",
      seatId: seat.seatId,
      text: seat.displayName,
    });
  });
  parts.push({ type: "text", text: ` ${verb}` });
  return parts;
}
