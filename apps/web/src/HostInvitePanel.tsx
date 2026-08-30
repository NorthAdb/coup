import { useEffect, useRef, useState } from "react";
import { sfx } from "@coup/web-desk";
import { copyText, lobbyStartBlockHint } from "./lanRoom";
import { LobbySeatList } from "./LobbySeatList";
import type { LobbySeat, RoomInvite } from "./lanRoom";

type HostInvitePanelProps = {
  room: RoomInvite;
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onRename: () => void;
  onConfigure: (seatId: string, config: { kind: "open" } | { kind: "closed" }) => void;
  onStart: () => void;
  onResumeMatch?: () => void;
  onBack: () => void;
  turnTimeLimitSec: number;
  onTurnTimeLimitChange: (seconds: number) => void;
};

const TURN_TIME_OPTIONS = [0, 30, 60, 90, 120];

/** 一键人数预设：座位 2..N 开放，其余关闭。 */
async function applySeatPreset(
  seats: LobbySeat[],
  playerCount: number,
  configure: (seatId: string, config: { kind: "open" } | { kind: "closed" }) => void,
) {
  for (const seat of seats) {
    if (seat.seatId === "1") continue;
    if (seat.kind === "remote_human") continue;
    const shouldOpen = Number(seat.seatId) <= playerCount;
    if (shouldOpen && seat.kind !== "open") {
      configure(seat.seatId, { kind: "open" });
    } else if (!shouldOpen && seat.kind !== "closed") {
      configure(seat.seatId, { kind: "closed" });
    }
  }
}

export function HostInvitePanel({
  room,
  seats,
  mySeatId,
  busy,
  displayNameDraft,
  onDisplayNameDraftChange,
  onRename,
  onConfigure,
  onStart,
  onResumeMatch,
  onBack,
  turnTimeLimitSec,
  onTurnTimeLimitChange,
}: HostInvitePanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [linkState, setLinkState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const prevOccupiedRef = useRef<number | null>(null);
  const inMatch = room.phase === "match";
  const inRematch = room.phase === "rematch";
  const gate = inMatch ? null : lobbyStartBlockHint(seats, room.phase);
  const canStart = gate === null;
  const occupiedCount = seats.filter(
    (seat) => seat.kind === "local_human" || seat.kind === "remote_human",
  ).length;
  const joinUrl =
    room.joinUrl ?? `${window.location.origin}/join?code=${room.code}`;

  // 有新玩家入座时播放提示音（房主侧）
  useEffect(() => {
    if (prevOccupiedRef.current != null && occupiedCount > prevOccupiedRef.current) {
      sfx.play("join");
    }
    prevOccupiedRef.current = occupiedCount;
  }, [occupiedCount]);

  async function copyWith(
    text: string,
    setState: (state: "idle" | "copied" | "failed") => void,
  ) {
    let copied = false;
    try {
      copied = await copyText(text);
    } catch {
      copied = false;
    }
    setState(copied ? "copied" : "failed");
    sfx.play(copied ? "confirm" : "error");
    window.setTimeout(() => setState("idle"), 2200);
  }

  function presetActive(count: number): boolean {
    const openOrHuman = seats.filter(
      (seat) =>
        seat.kind === "remote_human" ||
        (seat.kind !== "closed" && Number(seat.seatId) <= count && seat.seatId !== "1"),
    );
    const beyond = seats.filter(
      (seat) => seat.seatId !== "1" && Number(seat.seatId) > count,
    );
    return (
      openOrHuman.length === count - 1 &&
      beyond.every((seat) => seat.kind === "closed")
    );
  }

  return (
    <section className="lobby-card" aria-label="房间大厅">
      <div className="lobby-top">
        <div className="lobby-title">
          <p className="console-eyebrow">
            {inRematch ? "续局等待 · Rematch" : "房间大厅 · Lobby"}
          </p>
          <h2>政变 · 房间 {room.code}</h2>
        </div>
        <span className="lobby-phase-chip">
          {inMatch
            ? "对局进行中"
            : `${occupiedCount} / ${seats.filter((s) => s.kind !== "closed").length} 人就座`}
        </span>
      </div>

      <div className="lobby-grid">
        <div className="invite-panel">
          <div className="room-code-card">
            <span className="console-eyebrow">房间号</span>
            <div className="code-digits-display" aria-label={`房间号 ${room.code}`}>
              {room.code.split("").map((digit, index) => (
                <span key={index}>{digit}</span>
              ))}
            </div>
            <div className="invite-buttons">
              <button
                type="button"
                className="chip-btn"
                disabled={busy}
                onClick={() => void copyWith(room.code, setCopyState)}
              >
                {copyState === "copied" ? "✓ 已复制" : "复制房间号"}
              </button>
              <button
                type="button"
                className="chip-btn"
                disabled={busy}
                onClick={() => void copyWith(joinUrl, setLinkState)}
              >
                {linkState === "copied" ? "✓ 链接已复制" : "复制邀请链接"}
              </button>
            </div>
            <p className="gate-hint">把房间号发给朋友，他们在首页点「加入房间」即可入座。</p>
          </div>

          {inMatch ? (
            <>
              <p className="gate-hint ok">对局进行中，座位配置已锁定。</p>
              <button
                type="button"
                className="start-btn"
                disabled={busy || !onResumeMatch}
                onClick={() => {
                  sfx.play("confirm");
                  onResumeMatch?.();
                }}
              >
                返回对局
              </button>
            </>
          ) : (
            <>
              {!inRematch ? (
                <div className="lobby-settings">
                  <div className="setting-row">
                    <label>快捷人数（开 N-1 个空位，多余座位关闭）</label>
                    <div className="preset-row">
                      {[2, 3, 4, 5, 6].map((count) => (
                        <button
                          key={count}
                          type="button"
                          className={`preset-btn${presetActive(count) ? " active" : ""}`}
                          disabled={busy}
                          onClick={() => {
                            sfx.play("click");
                            void applySeatPreset(seats, count, onConfigure);
                          }}
                        >
                          {count} 人
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row">
                    <label>回合限时（超时由系统代为稳妥决策）</label>
                    <div className="preset-row">
                      {TURN_TIME_OPTIONS.map((seconds) => (
                        <button
                          key={seconds}
                          type="button"
                          className={`preset-btn${turnTimeLimitSec === seconds ? " active" : ""}`}
                          disabled={busy}
                          onClick={() => {
                            sfx.play("click");
                            onTurnTimeLimitChange(seconds);
                          }}
                        >
                          {seconds === 0 ? "不限时" : `${seconds} 秒`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="start-btn"
                disabled={busy || !canStart}
                onClick={() => {
                  sfx.play("confirm");
                  onStart();
                }}
              >
                {inRematch ? "开始新对局" : "开始对局"}
              </button>
              {gate ? (
                <p className="gate-hint">{gate}</p>
              ) : (
                <p className="gate-hint ok">
                  {inRematch
                    ? "全员已确认。点「开始新对局」正式开新局。"
                    : "门禁通过：有效座 2–6，无空位遗留。"}
                </p>
              )}
            </>
          )}
        </div>

        <div className="lobby-seats-panel">
          <LobbySeatList
            seats={seats}
            mySeatId={mySeatId}
            busy={busy}
            onConfigure={inMatch ? undefined : onConfigure}
            displayNameDraft={displayNameDraft}
            onDisplayNameDraftChange={onDisplayNameDraftChange}
            onRename={onRename}
          />
        </div>
      </div>

      <button
        type="button"
        className="ghost-btn"
        style={{ justifySelf: "start" }}
        disabled={busy}
        onClick={() => {
          sfx.play("click");
          onBack();
        }}
      >
        ← 返回入口
      </button>
    </section>
  );
}
