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
  trackSeat(roomCode: string, seatId: string): void;
  untrackSeat(roomCode: string, seatId: string): void;
  clearRoom(roomCode: string): void;
  clearAll(): void;
  noteHeartbeat(roomCode: string, seatId: string, now: number): void;
  tick(roomCode: string, now: number): void;
  resume(roomCode: string, seatId: string): { resumed: boolean; absence: SeatAbsence } | null;
  extendWait(roomCode: string, seatId: string, now: number): SeatAbsence | null;
  /**
   * After authority restart: put seats into a fresh reconnecting grace.
   * Downtime is not counted — soft-timeout clocks restart from this grace.
   */
  grantRecoveryGrace(seatIds: string[], roomCode: string, now: number): void;
  clearSeat(roomCode: string, seatId: string): void;
  get(roomCode: string, seatId: string): SeatAbsence | null;
  projectAll(roomCode: string, now: number): PublicSeatAbsence[];
  blocksAdvancement(
    roomCode: string,
    seatId: string,
    seatOwesDecision: boolean,
  ): boolean;
};

export function createSeatPresenceTracker(): SeatPresenceTracker {
  const seats = new Map<string, TrackedSeat>();

  function key(roomCode: string, seatId: string) {
    return `${roomCode}:${seatId}`;
  }

  function ensure(roomCode: string, seatId: string): TrackedSeat {
    const scopedKey = key(roomCode, seatId);
    let tracked = seats.get(scopedKey);
    if (!tracked) {
      tracked = {
        absence: createSeatAbsence(seatId),
        lastHeartbeatAt: null,
      };
      seats.set(scopedKey, tracked);
    }
    return tracked;
  }

  return {
    trackSeat(roomCode, seatId) {
      ensure(roomCode, seatId);
    },
    untrackSeat(roomCode, seatId) {
      seats.delete(key(roomCode, seatId));
    },
    clearRoom(roomCode) {
      const prefix = `${roomCode}:`;
      for (const scopedKey of seats.keys()) {
        if (scopedKey.startsWith(prefix)) seats.delete(scopedKey);
      }
    },
    clearAll() {
      seats.clear();
    },
    noteHeartbeat(roomCode, seatId, now) {
      const tracked = ensure(roomCode, seatId);
      tracked.lastHeartbeatAt = now;
      // Within grace, a heartbeat restores presence without credential rotation.
      // After 离席, resume-seat is required (and rotates the credential).
      if (tracked.absence.phase === "reconnecting") {
        tracked.absence = markSeatResumed(tracked.absence);
      }
    },
    tick(roomCode, now) {
      const prefix = `${roomCode}:`;
      for (const [scopedKey, tracked] of seats) {
        if (!scopedKey.startsWith(prefix)) continue;
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
    resume(roomCode, seatId) {
      const tracked = seats.get(key(roomCode, seatId));
      if (!tracked) return null;
      if (tracked.absence.phase === "present") {
        return { resumed: false, absence: tracked.absence };
      }
      tracked.absence = markSeatResumed(tracked.absence);
      tracked.lastHeartbeatAt = null;
      return { resumed: true, absence: tracked.absence };
    },
    extendWait(roomCode, seatId, now) {
      const tracked = seats.get(key(roomCode, seatId));
      if (!tracked) return null;
      tracked.absence = extendAbsenceWait(tracked.absence, now);
      return tracked.absence;
    },
    grantRecoveryGrace(seatIds, roomCode, now) {
      for (const seatId of seatIds) {
        const tracked = ensure(roomCode, seatId);
        tracked.lastHeartbeatAt = null;
        tracked.absence = markChannelDrop(createSeatAbsence(seatId), now);
      }
    },
    clearSeat(roomCode, seatId) {
      seats.delete(key(roomCode, seatId));
    },
    get(roomCode, seatId) {
      return seats.get(key(roomCode, seatId))?.absence ?? null;
    },
    projectAll(roomCode, now) {
      const prefix = `${roomCode}:`;
      return [...seats.entries()]
        .filter(([scopedKey]) => scopedKey.startsWith(prefix))
        .map(([, tracked]) => projectSeatAbsence(tracked.absence, now))
        .filter((p) => p.phase !== "present");
    },
    blocksAdvancement(roomCode, seatId, seatOwesDecision) {
      const tracked = seats.get(key(roomCode, seatId));
      if (!tracked) return false;
      return seatBlocksAdvancement(tracked.absence, seatOwesDecision);
    },
  };
}
