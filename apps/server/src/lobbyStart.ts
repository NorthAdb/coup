import type { MatchSetupSeatInput } from "./matchSetup.js";
import type { LobbySeat, RoomRecord } from "./roomRegistry.js";

export type LobbyStartGateFailure =
  | "open_seats_remain"
  | "too_few_seats"
  | "too_many_seats"
  | "room_not_lobby"
  | "seats_not_confirmed";

export function effectiveLobbySeats(room: RoomRecord): LobbySeat[] {
  return room.seats.filter(
    (seat) =>
      seat.kind === "local_human" || seat.kind === "remote_human",
  );
}

export function evaluateLobbyStartGates(
  room: RoomRecord,
  options?: { allowMatchPhase?: boolean; allowRematchPhase?: boolean },
): { ok: true } | { ok: false; reason: LobbyStartGateFailure } {
  const phaseOk =
    room.phase === "lobby" ||
    (options?.allowMatchPhase === true && room.phase === "match") ||
    (options?.allowRematchPhase === true && room.phase === "rematch");
  if (!phaseOk) {
    return { ok: false, reason: "room_not_lobby" };
  }
  if (room.seats.some((seat) => seat.kind === "open")) {
    return { ok: false, reason: "open_seats_remain" };
  }
  if (room.phase === "rematch") {
    const awaiting = room.seats.some(
      (seat) => seat.rematchStatus === "awaiting",
    );
    if (awaiting) {
      return { ok: false, reason: "seats_not_confirmed" };
    }
  }
  const effective = effectiveLobbySeats(room);
  if (effective.length < 2) {
    return { ok: false, reason: "too_few_seats" };
  }
  if (effective.length > 6) {
    return { ok: false, reason: "too_many_seats" };
  }
  return { ok: true };
}

export function lobbySeatsToMatchSetup(
  room: RoomRecord,
): MatchSetupSeatInput[] {
  return effectiveLobbySeats(room).map((seat) => ({
    seatId: seat.seatId,
    controller: seat.kind === "remote_human" ? "remote_human" : "local_human",
    displayName: seat.displayName ?? (seat.kind === "local_human" ? "你" : "客人"),
  }));
}
