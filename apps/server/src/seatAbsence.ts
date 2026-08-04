/**
 * Remote-seat absence state machine (ticket 13).
 * Injectable clock via `now` arguments — no timers inside.
 */

export const GRACE_MS = 15_000;
export const SOFT_TIMEOUT_MS = 5 * 60_000;

export type AbsencePhase =
  | "present"
  | "reconnecting"
  | "absent"
  | "timed_out";

export type SeatAbsence = {
  seatId: string;
  phase: AbsencePhase;
  /** When the current phase ends; null for present / timed_out. */
  deadlineAt: number | null;
  disconnectedAt: number | null;
};

export type PublicSeatAbsence = {
  seatId: string;
  phase: AbsencePhase;
  remainingMs: number;
  deadlineAt: number | null;
};

export function createSeatAbsence(seatId: string): SeatAbsence {
  return {
    seatId,
    phase: "present",
    deadlineAt: null,
    disconnectedAt: null,
  };
}

export function markChannelDrop(presence: SeatAbsence, now: number): SeatAbsence {
  if (presence.phase !== "present") {
    return presence;
  }
  return {
    ...presence,
    phase: "reconnecting",
    disconnectedAt: now,
    deadlineAt: now + GRACE_MS,
  };
}

export function tickSeatAbsence(presence: SeatAbsence, now: number): SeatAbsence {
  let current = presence;
  for (let guard = 0; guard < 4; guard += 1) {
    if (current.phase === "reconnecting" && current.deadlineAt !== null) {
      if (now >= current.deadlineAt) {
        current = {
          ...current,
          phase: "absent",
          deadlineAt: current.deadlineAt + SOFT_TIMEOUT_MS,
        };
        continue;
      }
    }
    if (current.phase === "absent" && current.deadlineAt !== null) {
      if (now >= current.deadlineAt) {
        current = {
          ...current,
          phase: "timed_out",
          deadlineAt: null,
        };
        continue;
      }
    }
    break;
  }
  return current;
}

export function markSeatResumed(presence: SeatAbsence): SeatAbsence {
  return {
    ...presence,
    phase: "present",
    deadlineAt: null,
    disconnectedAt: null,
  };
}

/** Host disposition: keep waiting — reset soft timeout from now. */
export function extendAbsenceWait(presence: SeatAbsence, now: number): SeatAbsence {
  if (presence.phase !== "absent" && presence.phase !== "timed_out") {
    return presence;
  }
  return {
    ...presence,
    phase: "absent",
    deadlineAt: now + SOFT_TIMEOUT_MS,
  };
}

/**
 * Pause only when the seat owes a decision and has left reconnecting grace.
 * Reconnecting never pauses for that seat alone.
 */
export function seatBlocksAdvancement(
  presence: SeatAbsence,
  seatOwesDecision: boolean,
): boolean {
  if (!seatOwesDecision) return false;
  return presence.phase === "absent" || presence.phase === "timed_out";
}

export function projectSeatAbsence(
  presence: SeatAbsence,
  now: number,
): PublicSeatAbsence {
  const remainingMs =
    presence.deadlineAt === null
      ? 0
      : Math.max(0, presence.deadlineAt - now);
  return {
    seatId: presence.seatId,
    phase: presence.phase,
    remainingMs,
    deadlineAt: presence.deadlineAt,
  };
}
