import { agentBusyParts, type AgentBusyPhase, type BusySeat } from "./agentBusyLabel.ts";
import type { TextPart } from "@coup/web-desk";

export type BusyStage = {
  eyebrow: string;
  title: string;
  titleParts: TextPart[];
  text: string;
  claim: null;
};

/**
 * While a human decision request is in flight, the client still holds the
 * pre-submit SeatView — so live stage copy can falsely say "your turn" while
 * an Agent seat is actually blocking. Override the stage in that window.
 */
export function busyStageOverride(input: {
  busy: boolean;
  agentPhase: AgentBusyPhase;
  seats: readonly BusySeat[];
}): BusyStage | null {
  if (!input.busy) return null;
  if (input.agentPhase === "idle") return null;

  const titleParts = agentBusyParts(input.agentPhase, input.seats);
  return {
    eyebrow: "等待其他座位",
    title: titleParts.map((part) => part.text).join(""),
    titleParts,
    text: "这些座位正在决策；名单在等待结束前保持不变。",
    claim: null,
  };
}
