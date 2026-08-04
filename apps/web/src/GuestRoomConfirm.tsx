import type { RoomInvite } from "./lanRoom";

type GuestRoomConfirmProps = {
  room: RoomInvite;
  origin: string;
  onBack: () => void;
};

export function GuestRoomConfirm({
  room,
  origin,
  onBack,
}: GuestRoomConfirmProps) {
  return (
    <section className="panel" aria-label="已找到房间">
      <button type="button" className="ghost" onClick={onBack}>
        ← 返回
      </button>
      <p className="eyebrow">已连接到主机</p>
      <h2>房间 {room.code}</h2>
      <p className="lede">
        已确认主机上存在该房间（{origin}）。占座与大厅将在后续实现。
      </p>
      <p className="hint ok">房间阶段：{room.phase}</p>
    </section>
  );
}
