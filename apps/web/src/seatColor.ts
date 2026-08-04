/** Fixed presentation-layer seat tints for 2–6 players (by seat order). */
export const SEAT_TINT_COUNT = 6;

/** CSS class for a seat's stable tint (`seat-tint-0` … `seat-tint-5`). */
export function seatTintClass(seatIndex: number): string {
  const index =
    ((seatIndex % SEAT_TINT_COUNT) + SEAT_TINT_COUNT) % SEAT_TINT_COUNT;
  return `seat-tint-${index}`;
}

/** Resolve tint class from ordered public seats. */
export function seatTintClassForId(
  seats: readonly { seatId: string }[],
  seatId: string,
): string {
  const index = seats.findIndex((seat) => seat.seatId === seatId);
  return seatTintClass(index < 0 ? 0 : index);
}
