import type { LobbySeat, RoomInvite } from "./lanRoom";
import { LobbySeatList } from "./LobbySeatList";

type GuestRoomConfirmProps = {
  room: RoomInvite;
  origin: string;
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onClaim: (seatId: string) => void;
  onRename: () => void;
  onBack: () => void;
};

export function GuestRoomConfirm({
  room,
  origin,
  seats,
  mySeatId,
  busy,
  displayNameDraft,
  onDisplayNameDraftChange,
  onClaim,
  onRename,
  onBack,
}: GuestRoomConfirmProps) {
  return (
    <section className="panel" aria-label="已找到房间">
      <button type="button" className="ghost" disabled={busy} onClick={onBack}>
        ← 返回
      </button>
      <p className="eyebrow">已连接到主机</p>
      <h2>房间 {room.code}</h2>
      <p className="lede">
        已确认主机上存在该房间（{origin}）。选择开放座位占座；刷新后凭座位凭证认回。
      </p>
      <p className="hint ok">房间阶段：{room.phase}</p>

      <h3 className="lobby-seats-heading">座位</h3>
      <LobbySeatList
        seats={seats}
        mySeatId={mySeatId}
        busy={busy}
        onClaim={onClaim}
        displayNameDraft={displayNameDraft}
        onDisplayNameDraftChange={onDisplayNameDraftChange}
        onRename={onRename}
      />
    </section>
  );
}
