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
  onResumeMatch?: () => void;
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
  onResumeMatch,
  onBack,
}: GuestRoomConfirmProps) {
  return (
    <section className="panel guest-console" aria-label="客人大厅">
      <button type="button" className="ghost" disabled={busy} onClick={onBack}>
        ← 返回
      </button>
      <div className="guest-console-grid">
        <div className="guest-console-meta">
          <p className="eyebrow">加入方 · 大厅</p>
          <h2>房间 {room.code}</h2>
          <p className="lede">
            {room.phase === "match"
              ? "已确认房间存在。"
              : room.phase === "rematch"
                ? "已确认房间存在，正处于续局等待。"
                : "已确认房间存在。选择开放座位占座；开局由主机决定。"}
          </p>
          <p className="hint ok">
            {room.phase === "match"
              ? "对局进行中，座位已锁定。"
              : room.phase === "rematch"
                ? "等待确认加入新对局…"
                : "等待主机开局…"}
          </p>
          {room.phase === "match" && onResumeMatch ? (
            <button type="button" disabled={busy} onClick={onResumeMatch}>
              返回对局
            </button>
          ) : null}
        </div>
        <div className="guest-console-seats">
          <h3 className="lobby-seats-heading">座位矩阵</h3>
          <LobbySeatList
            seats={seats}
            mySeatId={mySeatId}
            busy={busy}
            onClaim={room.phase === "match" ? undefined : onClaim}
            displayNameDraft={displayNameDraft}
            onDisplayNameDraftChange={onDisplayNameDraftChange}
            onRename={onRename}
          />
        </div>
      </div>
    </section>
  );
}
