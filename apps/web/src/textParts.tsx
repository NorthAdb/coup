import type { TextPart } from "./matchCopy";
import { seatTintClassForId } from "./seatColor";

type NamedSeat = { seatId: string; displayName: string };

/** Render text/seat segments with stable seat tints. */
export function TextPartsView({
  parts,
  seats,
}: {
  parts: readonly TextPart[];
  seats: readonly NamedSeat[];
}) {
  return (
    <>
      {parts.map((part, index) =>
        part.type === "seat" ? (
          <span
            key={`${part.seatId}-${index}`}
            className={`seat-name-tint ${seatTintClassForId(seats, part.seatId)}`}
          >
            {part.text}
          </span>
        ) : (
          <span key={`t-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}
