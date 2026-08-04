import type { MatchSetupSeatInput } from "./matchSetup.js";
import type { LobbySeat, RoomRecord } from "./roomRegistry.js";

export type LobbyStartGateFailure =
  | "open_seats_remain"
  | "too_few_seats"
  | "too_many_seats"
  | "room_not_lobby";

export function effectiveLobbySeats(room: RoomRecord): LobbySeat[] {
  return room.seats.filter(
    (seat) =>
      seat.kind === "local_human" ||
      seat.kind === "remote_human" ||
      seat.kind === "local_agent",
  );
}

export function evaluateLobbyStartGates(
  room: RoomRecord,
): { ok: true } | { ok: false; reason: LobbyStartGateFailure } {
  if (room.phase !== "lobby") {
    return { ok: false, reason: "room_not_lobby" };
  }
  if (room.seats.some((seat) => seat.kind === "open")) {
    return { ok: false, reason: "open_seats_remain" };
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
  return effectiveLobbySeats(room).map((seat) => {
    if (seat.kind === "local_agent") {
      return {
        seatId: seat.seatId,
        controller: "stub_agent" as const,
        displayName: seat.displayName ?? "Agent",
        cli: seat.cli ?? "stub",
        modelId: seat.modelId,
      };
    }
    if (seat.kind === "remote_human") {
      return {
        seatId: seat.seatId,
        controller: "remote_human" as const,
        displayName: seat.displayName ?? "客人",
      };
    }
    return {
      seatId: seat.seatId,
      controller: "local_human" as const,
      displayName: seat.displayName ?? "你",
    };
  });
}
