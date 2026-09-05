import type { LobbySeat } from "./lanRoom";
import { seatKindLabel } from "./lanRoom";

export type HostSeatConfig = { kind: "open" } | { kind: "closed" } | { kind: "bot" };

type LobbySeatListProps = {
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  /** When set, open seats show a claim control. */
  onClaim?: (seatId: string) => void;
  /** Guest-only: release my own claimed seat back to open (lobby phase). */
  onLeave?: () => void;
  /** Host-only: configure seats 2–6. */
  onConfigure?: (seatId: string, config: HostSeatConfig) => void;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onRename?: () => void;
};

/** 大厅座位圆盘：每个座位一张位次卡，状态一目了然。 */
export function LobbySeatList({
  seats,
  mySeatId,
  busy,
  onClaim,
  onLeave,
  onConfigure,
  displayNameDraft,
  onDisplayNameDraftChange,
  onRename,
}: LobbySeatListProps) {
  return (
    <div className="lobby-seats" aria-label="座位">
      <ul className="seat-grid">
        {seats.map((seat) => {
          const mine = mySeatId === seat.seatId;
          const configurable =
            Boolean(onConfigure) &&
            seat.kind !== "local_human" &&
            seat.seatId !== "1";
          const claimable = Boolean(onClaim) && seat.kind === "open" && !mySeatId;
          const occupied =
            seat.kind === "local_human" || seat.kind === "remote_human" || seat.kind === "bot";
          const initial = seat.displayName?.slice(0, 1) ?? String(seat.seatId);
          return (
            <li
              key={seat.seatId}
              className={[
                "lobby-seat",
                mine ? "mine" : "",
                occupied ? "occupied" : "",
                seat.kind === "closed" ? "closed" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="seat-orb" aria-hidden="true">
                {occupied || mine ? initial : "—"}
              </span>
              <span className="lobby-seat-name">
                {seat.displayName ?? `座位 ${seat.seatId}`}
                {mine && seat.displayName !== "你" ? "（你）" : ""}
              </span>
              <span className="lobby-seat-kind">
                {seatKindLabel(seat.kind)}
                {mine ? " · 你" : ""}
              </span>
              {seat.rematchStatus ? (
                <span className="lobby-seat-rematch">
                  {seat.rematchStatus === "awaiting"
                    ? "待确认加入"
                    : seat.rematchStatus === "confirmed"
                      ? "已确认加入"
                      : "已离开"}
                </span>
              ) : null}
              <span className="seat-actions">
                {claimable ? (
                  <button
                    type="button"
                    className="chip-btn"
                    disabled={busy}
                    onClick={() => onClaim?.(seat.seatId)}
                  >
                    入座
                  </button>
                ) : null}
                {mine && seat.kind === "remote_human" && onLeave ? (
                  <button
                    type="button"
                    className="mini-toggle"
                    disabled={busy}
                    onClick={onLeave}
                  >
                    让出座位
                  </button>
                ) : null}
                {configurable && onConfigure ? (
                  seat.kind === "open" ? (
                    <>
                      <button
                        type="button"
                        className="mini-toggle"
                        disabled={busy}
                        onClick={() => onConfigure(seat.seatId, { kind: "bot" })}
                      >
                        加AI
                      </button>
                      <button
                        type="button"
                        className="mini-toggle close"
                        disabled={busy}
                        onClick={() => onConfigure(seat.seatId, { kind: "closed" })}
                      >
                        关闭
                      </button>
                    </>
                  ) : seat.kind === "bot" ? (
                    <button
                      type="button"
                      className="mini-toggle close"
                      disabled={busy}
                      onClick={() => onConfigure(seat.seatId, { kind: "open" })}
                    >
                      撤下AI
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mini-toggle"
                      disabled={busy}
                      onClick={() => onConfigure(seat.seatId, { kind: "open" })}
                    >
                      重新开放
                    </button>
                  )
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {mySeatId ? (
        <label className="field" style={{ marginTop: "0.9rem", maxWidth: "26rem" }}>
          你的名字
          <span className="rename-row">
            <input
              value={displayNameDraft}
              disabled={busy}
              maxLength={12}
              placeholder="起一个桌上的名字"
              onChange={(event) => onDisplayNameDraftChange(event.target.value)}
            />
            {onRename ? (
              <button
                type="button"
                className="mini-toggle"
                disabled={busy}
                onClick={onRename}
              >
                改名
              </button>
            ) : null}
          </span>
        </label>
      ) : null}
    </div>
  );
}
