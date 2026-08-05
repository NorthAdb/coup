import type { LobbySeat } from "./lanRoom";
import { seatKindLabel } from "./lanRoom";

export type HostSeatConfig = { kind: "open" } | { kind: "closed" };

type LobbySeatListProps = {
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  /** When set, open seats show a claim control. */
  onClaim?: (seatId: string) => void;
  /** Host-only: configure seats 2–6. */
  onConfigure?: (seatId: string, config: HostSeatConfig) => void;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onRename?: () => void;
};

export function LobbySeatList({
  seats,
  mySeatId,
  busy,
  onClaim,
  onConfigure,
  displayNameDraft,
  onDisplayNameDraftChange,
  onRename,
}: LobbySeatListProps) {
  return (
    <div className="lobby-seats" aria-label="座位">
      <ul className="lobby-seat-list">
        {seats.map((seat) => {
          const mine = mySeatId === seat.seatId;
          const configurable =
            Boolean(onConfigure) &&
            seat.kind !== "local_human" &&
            seat.seatId !== "1";
          const configValue =
            seat.kind === "closed"
              ? "closed"
              : seat.kind === "remote_human"
                ? "remote_human"
                : "open";
          return (
            <li
              key={seat.seatId}
              className={`lobby-seat${mine ? " mine" : ""}${
                configurable ? " configurable" : ""
              }`}
            >
              <span className="lobby-seat-id">座 {seat.seatId}</span>
              <span className="lobby-seat-kind">{seatKindLabel(seat.kind)}</span>
              {seat.rematchStatus ? (
                <span className="lobby-seat-rematch">
                  {seat.rematchStatus === "awaiting"
                    ? "待确认"
                    : seat.rematchStatus === "confirmed"
                      ? "已确认加入"
                      : "已离开"}
                </span>
              ) : null}
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
              {configurable && onConfigure ? (
                <div className="lobby-seat-config">
                  <select
                    aria-label={`座位 ${seat.seatId} 类型`}
                    disabled={busy}
                    value={configValue}
                    onChange={(event) => {
                      const kind = event.target.value;
                      if (kind === "open") {
                        onConfigure(seat.seatId, { kind: "open" });
                      } else if (kind === "closed") {
                        onConfigure(seat.seatId, { kind: "closed" });
                      }
                    }}
                  >
                    {seat.kind === "remote_human" ? (
                      <option value="remote_human" disabled>
                        已占（远程）
                      </option>
                    ) : null}
                    <option value="open">开放占座</option>
                    <option value="closed">关闭</option>
                  </select>
                </div>
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
