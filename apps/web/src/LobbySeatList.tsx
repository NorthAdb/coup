import type { LobbySeat } from "./lanRoom";
import { seatKindLabel } from "./lanRoom";

type LobbySeatListProps = {
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  /** When set, open seats show a claim control. */
  onClaim?: (seatId: string) => void;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onRename?: () => void;
};

export function LobbySeatList({
  seats,
  mySeatId,
  busy,
  onClaim,
  displayNameDraft,
  onDisplayNameDraftChange,
  onRename,
}: LobbySeatListProps) {
  return (
    <div className="lobby-seats" aria-label="座位">
      <ul className="lobby-seat-list">
        {seats.map((seat) => {
          const mine = mySeatId === seat.seatId;
          return (
            <li
              key={seat.seatId}
              className={`lobby-seat${mine ? " mine" : ""}`}
            >
              <span className="lobby-seat-id">座 {seat.seatId}</span>
              <span className="lobby-seat-kind">{seatKindLabel(seat.kind)}</span>
              <span className="lobby-seat-name">
                {seat.displayName ?? "—"}
                {mine ? "（你）" : ""}
              </span>
              {onClaim && seat.kind === "open" ? (
                <button
                  type="button"
                  disabled={busy || Boolean(mySeatId)}
                  onClick={() => onClaim(seat.seatId)}
                >
                  占座
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {mySeatId ? (
        <label className="field">
          显示名
          <span className="lobby-rename-row">
            <input
              value={displayNameDraft}
              disabled={busy}
              maxLength={24}
              onChange={(event) => onDisplayNameDraftChange(event.target.value)}
            />
            {onRename ? (
              <button type="button" disabled={busy} onClick={onRename}>
                改名
              </button>
            ) : null}
          </span>
        </label>
      ) : null}
    </div>
  );
}
