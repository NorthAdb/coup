import { useEffect, useRef, useState } from "react";
import { sfx } from "@coup/web-desk";
import { fetchRoom, loadPlayerName, savePlayerName, type RoomInvite } from "./lanRoom";

type JoinRoomPageProps = {
  busy: boolean;
  onBack: () => void;
  onJoined: (room: RoomInvite, origin: string) => void;
  onError: (message: string) => void;
  initialCode?: string;
};

const SLOTS = [0, 1, 2, 3];

/** 4 位分段房号输入：自动前进、退格回跳、粘贴分发、输满即校验。 */
function CodeInput({
  value,
  onChange,
  disabled,
  onCompleted,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled: boolean;
  onCompleted: (code: string) => void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = SLOTS.map((i) => value[i] ?? "");

  useEffect(() => {
    refs.current[Math.min(value.length, 3)]?.focus();
    // 仅首次聚焦
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusSlot(index: number) {
    const clamped = Math.max(0, Math.min(3, index));
    refs.current[clamped]?.focus();
    refs.current[clamped]?.select();
  }

  function writeSlot(index: number, digit: string) {
    const arr = [...digits];
    arr[index] = digit;
    onChange(arr.join("").replace(/\s/g, ""));
  }

  return (
    <div className="code-input-row" aria-label="房间号输入">
      {SLOTS.map((slot) => (
        <input
          key={slot}
          ref={(el) => {
            refs.current[slot] = el;
          }}
          className={`code-digit${digits[slot] ? " filled" : ""}`}
          value={digits[slot]}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          aria-label={`房间号第 ${slot + 1} 位`}
          onChange={(event) => {
            const raw = event.target.value.replace(/\D/g, "");
            if (raw.length > 1) {
              // 整段粘贴
              onChange(raw.slice(0, 4));
              if (raw.length >= 4) onCompleted(raw.slice(0, 4));
              else focusSlot(raw.length);
              sfx.play("click");
              return;
            }
            writeSlot(slot, raw);
            if (raw) {
              sfx.play("click");
              const next = [...digits];
              next[slot] = raw;
              const joined = next.join("").replace(/\s/g, "");
              if (joined.length === 4) {
                onCompleted(joined);
              } else {
                focusSlot(slot + 1);
              }
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace") {
              if (digits[slot]) {
                writeSlot(slot, "");
              } else if (slot > 0) {
                focusSlot(slot - 1);
                const arr = [...digits];
                arr[slot - 1] = "";
                onChange(arr.join("").replace(/\s/g, ""));
                event.preventDefault();
              }
            }
            if (event.key === "ArrowLeft") focusSlot(slot - 1);
            if (event.key === "ArrowRight") focusSlot(slot + 1);
            if (event.key === "Enter" && value.length === 4) {
              onCompleted(value);
            }
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
      ))}
    </div>
  );
}

export function JoinRoomPage({
  busy,
  onBack,
  onJoined,
  onError,
  initialCode = "",
}: JoinRoomPageProps) {
  const [code, setCode] = useState(initialCode.replace(/\D/g, "").slice(0, 4));
  const [localError, setLocalError] = useState("");
  const [name, setName] = useState(() => loadPlayerName());
  const origin = window.location.origin;

  async function submit(codeValue: string) {
    const trimmed = codeValue.replace(/\D/g, "");
    if (!/^\d{4}$/.test(trimmed)) {
      setLocalError("请输满 4 位数字房间号");
      return;
    }
    setLocalError("");
    savePlayerName(name);
    try {
      const room = await fetchRoom(origin, trimmed);
      onJoined(room, origin);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "加入失败");
    }
  }

  return (
    <section className="console-card" aria-label="加入房间">
      <button
        type="button"
        className="ghost-btn"
        style={{ justifySelf: "start" }}
        disabled={busy}
        onClick={onBack}
      >
        ← 返回
      </button>
      <p className="console-eyebrow">Join · 加入房间</p>
      <h2>输入房间号</h2>
      <p className="console-lede">向房主要 4 位房间号；输满即可确认。</p>
      <CodeInput
        value={code}
        onChange={(next) => {
          setCode(next);
          setLocalError("");
        }}
        disabled={busy}
        onCompleted={(full) => void submit(full)}
      />
      <label className="field">
        你的名字（进房后可再改）
        <input
          value={name}
          disabled={busy}
          maxLength={12}
          placeholder="路人甲"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p className="console-error" role="alert">
        {localError}
      </p>
      <div className="console-actions">
        <button
          type="button"
          className="primary-btn"
          disabled={busy || code.length !== 4}
          onClick={() => void submit(code)}
        >
          确认加入
        </button>
      </div>
    </section>
  );
}
