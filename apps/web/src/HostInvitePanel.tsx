import type { LobbySeat, RoomInvite } from "./lanRoom";
import { LobbySeatList } from "./LobbySeatList";

type HostInvitePanelProps = {
  room: RoomInvite;
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onRename: () => void;
  onSelectHost: (host: string) => void;
  onCopy: () => void;
  onBack: () => void;
};

export function HostInvitePanel({
  room,
  seats,
  mySeatId,
  busy,
  displayNameDraft,
  onDisplayNameDraftChange,
  onRename,
  onSelectHost,
  onCopy,
  onBack,
}: HostInvitePanelProps) {
  return (
    <section className="panel host-invite" aria-label="主机邀请">
      <button type="button" className="ghost" disabled={busy} onClick={onBack}>
        ← 返回入口
      </button>
      <p className="eyebrow">主机大厅 · 邀请</p>
      <p className="code-xl">{room.code}</p>
      {room.joinUrl ? (
        <>
          <button type="button" disabled={busy} onClick={() => onCopy()}>
            复制加入链接
          </button>
          <code className="join-url">{room.joinUrl}</code>
        </>
      ) : (
        <p className="hint">无可用局域网地址，无法生成加入链接。</p>
      )}
      {room.candidates.length > 0 ? (
        <label className="field">
          展示网卡 IP
          <select
            value={room.selectedHost ?? ""}
            disabled={busy}
            onChange={(event) => onSelectHost(event.target.value)}
          >
            {room.candidates.map((ip) => (
              <option key={ip} value={ip}>
                {ip}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <h3 className="lobby-seats-heading">座位</h3>
      <LobbySeatList
        seats={seats}
        mySeatId={mySeatId}
        busy={busy}
        displayNameDraft={displayNameDraft}
        onDisplayNameDraftChange={onDisplayNameDraftChange}
        onRename={onRename}
      />

      <p className="fine">
        加入方须用完整链接，或「地址 + 房间号」。开局门禁与指挥台配置由后续票收口。
      </p>
      <p className="hint ok">
        主机模式已监听局域网（端口 {room.port}）。返回入口不会自动切回
        loopback；完整解散与回本机绑定由后续票收口。
      </p>
    </section>
  );
}
