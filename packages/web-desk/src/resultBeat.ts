import type { SeatView } from "@coup/protocol";
import type { DeskPace } from "./deskPacing.js";
import {
  eventParts,
  joinTextParts,
  seatCalloutFromEvent,
  type SeatCallout,
  type TextPart,
} from "./matchCopy.js";

export type BeatWeight = "heavy" | "light" | "skip";

export type StageBeat = {
  eyebrow: string;
  title: string;
  text: string;
  titleParts?: TextPart[];
};

/** Classify public events for presentation-layer result beats (ADR-0002). */
export function beatWeightForEvent(
  event: SeatView["projectedHistory"][number],
): BeatWeight {
  switch (event.type) {
    case "action_failed":
    case "claim_proven":
    case "claim_conceded":
    case "influence_revealed":
    case "seat_eliminated":
      return "heavy";
    case "action_declared":
    case "action_resolved":
    case "block_declared":
    case "challenge_declared":
    case "response_passed":
      return "light";
    case "turn_advanced":
    case "match_started":
    case "match_finished":
      return "skip";
    default:
      return "skip";
  }
}

export function heavyBeatHoldMs(
  pace: DeskPace,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) return 1200;
  return pace === "fast" ? 900 : 1800;
}

export function lightBeatHoldMs(
  pace: DeskPace,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) return 400;
  return pace === "fast" ? 280 : 550;
}

/** Challenge / pass-challenge linger on the seat bubble (~3s balanced). */
export function challengeCalloutBeatHoldMs(
  pace: DeskPace,
  prefersReducedMotion: boolean,
): number {
  if (prefersReducedMotion) return 2500;
  return pace === "fast" ? 1800 : 3000;
}

export function isChallengeCalloutEvent(
  event: SeatView["projectedHistory"][number],
): boolean {
  return (
    event.type === "challenge_declared" ||
    (event.type === "response_passed" && event.responseType === "challenge")
  );
}

type CalloutSeat = { seatId: string; displayName: string };

/** Central-stage "what just happened" copy for a single public event. */
export function stageBeatFromEvent(
  event: SeatView["projectedHistory"][number],
  seats: readonly CalloutSeat[],
): StageBeat | null {
  const weight = beatWeightForEvent(event);
  if (weight === "skip") return null;
  const titleParts = eventParts(
    event,
    seats as SeatView["publicState"]["seats"],
  );
  return {
    eyebrow: weight === "heavy" ? "刚才发生" : "动态",
    title: joinTextParts(titleParts),
    titleParts,
    text:
      weight === "heavy"
        ? "看清这一拍后再继续桌上的连锁结果。"
        : "短暂停顿后继续。",
  };
}

export function yourTurnStageBeat(): StageBeat {
  return {
    eyebrow: "轮到你",
    title: "请作出下一步选择",
    text: "连锁结果已播完，舞台回到当前可行动状态。",
  };
}

export type ReplayStep = {
  weight: BeatWeight;
  stage: StageBeat | null;
  callout: SeatCallout | null;
  event: SeatView["projectedHistory"][number];
};

/** Build ordered presentation steps for a fresh history delta. */
export function buildResultBeatSteps(
  events: readonly SeatView["projectedHistory"][number][],
  seats: readonly CalloutSeat[],
): ReplayStep[] {
  const steps: ReplayStep[] = [];
  for (const event of events) {
    const weight = beatWeightForEvent(event);
    if (weight === "skip") continue;
    steps.push({
      weight,
      stage: stageBeatFromEvent(event, seats),
      callout: seatCalloutFromEvent(event, seats),
      event,
    });
  }
  return steps;
}
