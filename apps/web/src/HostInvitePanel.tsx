import { useState } from "react";
import { copyText } from "./lanRoom";
import { lobbyStartBlockHint } from "./lanRoom";
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
};

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
}: HostInvitePanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const inMatch = room.phase === "match";
  const inRematch = room.phase === "rematch";
  const gate = inMatch ? null : lobbyStartBlockHint(seats, room.phase);
  const canStart = gate === null;

  async function handleCopy() {
    let copied = false;
    try {
      copied = await copyText(room.code);
    } catch {
      copied = false;
    }
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2200);
  }

  return (
    <section className="panel host-console" aria-label="房间大厅">
      <button type="button" className="ghost" disabled={busy} onClick={onBack}>
        ← 返回入口
      </button>

      <div className="host-console-grid">
        <div className="host-console-invite">
          <p className="eyebrow">
            {inRematch ? "续局等待 · 邀请与开局" : "房间大厅 · 邀请与开局"}
          </p>
          <p className="code-xl">{room.code}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleCopy()}
          >
            {copyState === "copied" ? "已复制" : "复制房间号"}
          </button>
          {copyState === "failed" ? (
            <p className="hint">自动复制失败，请手动记下房间号。</p>
          ) : (
            <p className="hint">把 4 位房间号发给朋友，他们在首页输入即可加入。</p>
          )}

          <div className="host-console-actions">
            {inMatch ? (
              <button
                type="button"
                disabled={busy || !onResumeMatch}
                onClick={() => onResumeMatch?.()}
              >
                返回对局
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !canStart}
                onClick={onStart}
              >
                {inRematch ? "开始新对局" : "开始对局"}
              </button>
            )}
          </div>
          {inMatch ? (
            <p className="hint ok">对局进行中，座位配置已锁定。</p>
          ) : inRematch ? (
            gate ? (
              <p className="hint">{gate}</p>
            ) : (
              <p className="hint ok">
                全部座位已确认加入。点「开始新对局」正式开新局。
              </p>
            )
          ) : gate ? (
            <p className="hint">{gate}</p>
          ) : (
            <p className="hint ok">门禁通过：有效座 2–6，无开放空槽。</p>
          )}
        </div>

        <div className="host-console-seats">
          <h3 className="lobby-seats-heading">座位矩阵</h3>
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
    </section>
  );
}
