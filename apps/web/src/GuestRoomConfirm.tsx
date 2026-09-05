import { sfx } from "@coup/web-desk";
import type { LobbySeat, RoomInvite } from "./lanRoom";
import { LobbySeatList } from "./LobbySeatList";

type GuestRoomConfirmProps = {
  room: RoomInvite;
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onClaim: (seatId: string) => void;
  onRename: () => void;
  onLeaveSeat?: () => void;
  onResumeMatch?: () => void;
  onSpectate?: () => void;
  onBack: () => void;
};

export function GuestRoomConfirm({
  room,
  seats,
  mySeatId,
  busy,
  displayNameDraft,
  onDisplayNameDraftChange,
  onClaim,
  onRename,
  onLeaveSeat,
  onResumeMatch,
  onSpectate,
  onBack,
}: GuestRoomConfirmProps) {
  const occupiedCount = seats.filter(
    (seat) => seat.kind === "local_human" || seat.kind === "remote_human",
  ).length;

  return (
    <section className="lobby-card" aria-label="客人大厅">
      <div className="lobby-top">
        <div className="lobby-title">
          <p className="console-eyebrow">Guest · 加入方</p>
          <h2>政变 · 房间 {room.code}</h2>
        </div>
        <span className="lobby-phase-chip">
          {room.phase === "match"
            ? "对局进行中"
            : room.phase === "rematch"
              ? "续局等待中"
              : `${occupiedCount} 人已就座`}
        </span>
      </div>

      <div className="lobby-grid">
        <div className="invite-panel">
          <p className="console-lede">
            {room.phase === "match"
              ? "这桌已经开局。没有你的空位时，可以先以观众身份观战。"
              : room.phase === "rematch"
                ? "房主正在组织下一局，确认加入即可保留原座位。"
                : "挑一个亮着的空位入座；开局由房主决定。"}
          </p>
          {room.phase === "match" && mySeatId && onResumeMatch ? (
            <button
              type="button"
              className="start-btn"
              disabled={busy}
              onClick={() => {
                sfx.play("confirm");
                onResumeMatch();
              }}
            >
              返回对局
            </button>
          ) : null}
          {room.phase !== "lobby" && onSpectate ? (
            <button
              type="button"
              className="ghost-btn"
              disabled={busy}
              onClick={() => {
                sfx.play("click");
                onSpectate();
              }}
            >
              以观众身份观战
            </button>
          ) : null}
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={() => {
              sfx.play("click");
              onBack();
            }}
          >
            ← 换个房间号
          </button>
        </div>
        <div className="lobby-seats-panel">
          <LobbySeatList
            seats={seats}
            mySeatId={mySeatId}
            busy={busy}
            onClaim={room.phase === "match" ? undefined : onClaim}
            onLeave={room.phase === "lobby" ? onLeaveSeat : undefined}
            displayNameDraft={displayNameDraft}
            onDisplayNameDraftChange={onDisplayNameDraftChange}
            onRename={onRename}
          />
        </div>
      </div>
    </section>
  );
}
