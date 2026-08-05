import { useState } from "react";
import { fetchRoom, type RoomInvite } from "./lanRoom";

type JoinRoomPageProps = {
  busy: boolean;
  onBack: () => void;
  onJoined: (room: RoomInvite, origin: string) => void;
  onError: (message: string) => void;
  initialCode?: string;
};

export function JoinRoomPage({
  busy,
  onBack,
  onJoined,
  onError,
  initialCode = "",
}: JoinRoomPageProps) {
  const [code, setCode] = useState(initialCode);
  const origin = window.location.origin;

  async function submit() {
    const trimmed = code.trim();
    if (!/^\d{4}$/.test(trimmed)) {
      onError("请输入 4 位数字房间号");
      return;
    }
    try {
      const room = await fetchRoom(origin, trimmed);
      onJoined(room, origin);
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
      <p className="lede">输入房主分享的 4 位房间号即可加入。</p>
      <label className="field">
        房间号
        <input
          value={code}
          disabled={busy}
          maxLength={4}
          inputMode="numeric"
          autoFocus
          onChange={(event) =>
            setCode(event.target.value.replace(/\D/g, ""))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="4821"
        />
      </label>
      <button type="button" disabled={busy} onClick={() => void submit()}>
        确认房间
      </button>
    </section>
  );
}
