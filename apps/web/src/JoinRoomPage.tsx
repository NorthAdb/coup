import { useState } from "react";
import { fetchRoom, parseManualJoin, type RoomInvite } from "./lanRoom";

type JoinRoomPageProps = {
  busy: boolean;
  onBack: () => void;
  onJoined: (room: RoomInvite, origin: string) => void;
  onError: (message: string) => void;
  initialLink?: string;
  initialCode?: string;
};

export function JoinRoomPage({
  busy,
  onBack,
  onJoined,
  onError,
  initialLink = "",
  initialCode = "",
}: JoinRoomPageProps) {
  const [joinLink, setJoinLink] = useState(initialLink);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState(initialCode);

  async function submit() {
    const parsed = parseManualJoin({ joinLink, address, code });
    if (!parsed.ok) {
      onError(parsed.reason);
      return;
    }
    try {
      // Seat cookies are host-only — claim must happen on the room's Origin.
      if (parsed.origin !== window.location.origin) {
        window.location.assign(
          `${parsed.origin}/join?code=${parsed.code}`,
        );
        return;
      }
      const room = await fetchRoom(parsed.origin, parsed.code);
      onJoined(room, parsed.origin);
    } catch (err) {
      onError(err instanceof Error ? err.message : "加入失败");
    }
  }

  return (
    <section className="panel join-b" aria-label="加入房间">
      <button type="button" className="ghost" disabled={busy} onClick={onBack}>
        ← 返回
      </button>
      <h2>加入</h2>
      <p className="lede">不能只填房间号。优先用主机发来的完整链接。</p>
      <label className="field">
        加入链接
        <textarea
          rows={3}
          value={joinLink}
          disabled={busy}
          onChange={(event) => setJoinLink(event.target.value)}
          placeholder="http://192.168.x.x:8787/join?code=4821"
        />
      </label>
      <p className="or">或</p>
      <div className="field-row">
        <label className="field">
          主机地址
          <input
            value={address}
            disabled={busy}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="192.168.1.42:8787"
          />
        </label>
        <label className="field">
          房间号
          <input
            value={code}
            disabled={busy}
            maxLength={4}
            onChange={(event) => setCode(event.target.value)}
            placeholder="4821"
          />
        </label>
      </div>
      <button type="button" disabled={busy} onClick={() => void submit()}>
        确认房间
      </button>
    </section>
  );
}
