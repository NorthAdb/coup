/**
 * Per-room remote-seat presence: heartbeat lease → absence state machine.
 */

import {
  createSeatAbsence,
  extendAbsenceWait,
  markChannelDrop,
  markSeatResumed,
  projectSeatAbsence,
  seatBlocksAdvancement,
  tickSeatAbsence,
  type PublicSeatAbsence,
  type SeatAbsence,
} from "./seatAbsence.js";

/** No heartbeat within this window counts as channel drop. */
export const HEARTBEAT_LEASE_MS = 4_000;

type TrackedSeat = {
  absence: SeatAbsence;
  lastHeartbeatAt: number | null;
};

export type SeatPresenceTracker = {
  trackSeat(seatId: string): void;
  untrackSeat(seatId: string): void;
  clear(): void;
  noteHeartbeat(seatId: string, now: number): void;
  tick(now: number): void;
  resume(seatId: string): { resumed: boolean; absence: SeatAbsence } | null;
  extendWait(seatId: string, now: number): SeatAbsence | null;
  clearSeat(seatId: string): void;
  get(seatId: string): SeatAbsence | null;
  projectAll(now: number): PublicSeatAbsence[];
  blocksAdvancement(
    seatId: string,
    seatOwesDecision: boolean,
  ): boolean;
};

export function createSeatPresenceTracker(): SeatPresenceTracker {
  const seats = new Map<string, TrackedSeat>();

  function ensure(seatId: string): TrackedSeat {
    let tracked = seats.get(seatId);
    if (!tracked) {
      tracked = {
        absence: createSeatAbsence(seatId),
        lastHeartbeatAt: null,
      };
      seats.set(seatId, tracked);
    }
    return tracked;
  }

  return {
    trackSeat(seatId) {
      ensure(seatId);
    },
    untrackSeat(seatId) {
      seats.delete(seatId);
    },
    clear() {
      seats.clear();
    },
    noteHeartbeat(seatId, now) {
      const tracked = ensure(seatId);
      tracked.lastHeartbeatAt = now;
      // Within grace, a heartbeat restores presence without credential rotation.
      // After 离席, resume-seat is required (and rotates the credential).
      if (tracked.absence.phase === "reconnecting") {
        tracked.absence = markSeatResumed(tracked.absence);
      }
    },
    tick(now) {
      for (const tracked of seats.values()) {
        if (
          tracked.absence.phase === "present" &&
          tracked.lastHeartbeatAt !== null &&
          now - tracked.lastHeartbeatAt > HEARTBEAT_LEASE_MS
        ) {
          // Backdate drop to lease expiry so large clock jumps catch up.
          const dropAt = tracked.lastHeartbeatAt + HEARTBEAT_LEASE_MS;
          tracked.absence = markChannelDrop(tracked.absence, dropAt);
        }
        tracked.absence = tickSeatAbsence(tracked.absence, now);
      }
    },
    resume(seatId) {
      const tracked = seats.get(seatId);
      if (!tracked) return null;
      if (tracked.absence.phase === "present") {
        return { resumed: false, absence: tracked.absence };
      }
      tracked.absence = markSeatResumed(tracked.absence);
      tracked.lastHeartbeatAt = null;
      return { resumed: true, absence: tracked.absence };
    },
    extendWait(seatId, now) {
      const tracked = seats.get(seatId);
      if (!tracked) return null;
      tracked.absence = extendAbsenceWait(tracked.absence, now);
      return tracked.absence;
    },
    clearSeat(seatId) {
      seats.delete(seatId);
    },
    get(seatId) {
      return seats.get(seatId)?.absence ?? null;
    },
    projectAll(now) {
      return [...seats.values()]
        .map((tracked) => projectSeatAbsence(tracked.absence, now))
        .filter((p) => p.phase !== "present");
    },
    blocksAdvancement(seatId, seatOwesDecision) {
      const tracked = seats.get(seatId);
      if (!tracked) return false;
      return seatBlocksAdvancement(tracked.absence, seatOwesDecision);
    },
  };
}
