import type { DomainEvent } from "@coup/domain";

/** Public event to show as a seat callout after an Agent seat decides. */
export function announcementEventForSeat(
  events: readonly DomainEvent[],
  seatId: string,
): DomainEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (!("seatId" in event) || event.seatId !== seatId) continue;
    switch (event.type) {
      case "challenge_declared":
      case "response_passed":
      case "block_declared":
      case "action_declared":
      case "claim_proven":
      case "claim_conceded":
      case "influence_revealed":
      case "action_resolved":
        return event;
      default:
        break;
    }
  }
  return null;
}

/** How long to hold before asking the next Agent seat (real CLI only). */
export function presentationHoldMs(event: DomainEvent | null): number {
  if (!event) return 900;
  if (event.type === "challenge_declared") return 3000;
  if (event.type === "response_passed" && event.responseType === "challenge") {
    return 3000;
  }
  if (event.type === "response_passed" && event.responseType === "block") {
    return 2500;
  }
  if (event.type === "block_declared") return 2500;
  if (event.type === "action_declared") return 1600;
  return 1200;
}

export function waitMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
