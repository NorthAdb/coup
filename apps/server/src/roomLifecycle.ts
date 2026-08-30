import type { ActiveMatch } from "./matchRuntime.js";
import type { RoomRecord } from "./roomRegistry.js";
import type { AbsencePhase } from "./seatAbsence.js";

export const MAX_ROOMS = 20;
export const IDLE_ROOM_RECLAIM_MS = 30 * 60_000;
/** 空房回收清扫间隔（惰性回收之外的兜底定时器，unref 不阻退出）。 */
export const IDLE_ROOM_SWEEP_MS = 5 * 60_000;

export type RoomAbsenceLookup = (seatId: string) => {
  phase: AbsencePhase;
} | null;

export function isRoomEmpty(
  room: RoomRecord,
  match: ActiveMatch | null,
  absence: RoomAbsenceLookup,
): boolean {
  if (room.phase !== "match") {
    return !room.seats.some(
      (seat) => seat.kind === "remote_human",
    );
  }

  if (!match) {
    return !room.seats.some(
      (seat) => seat.kind === "local_human" || seat.kind === "remote_human",
    );
  }

  for (const seat of match.state.seats) {
    if (seat.controller === "local_human") return false;
    if (seat.controller !== "remote_human") continue;
    if (seat.eliminated) continue;
    const current = absence(seat.seatId);
    if (!current || (current.phase !== "absent" && current.phase !== "timed_out")) {
      return false;
    }
  }
  return true;
}
