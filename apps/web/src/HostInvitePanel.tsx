import { useState } from "react";
import type { LobbySeat, RoomInvite } from "./lanRoom";
import { lobbyStartBlockHint } from "./lanRoom";
import {
  LobbySeatList,
  type HostSeatConfig,
} from "./LobbySeatList";
import {
  seatReadiness,
  type AgentCli,
  type CapabilityReport,
} from "./matchSetup";

type HostInvitePanelProps = {
  room: RoomInvite;
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  probing: boolean;
  capabilities: CapabilityReport | null;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onRename: () => void;
  onConfigure: (seatId: string, config: HostSeatConfig) => void;
  onProbe: () => void;
  onStart: () => void;
  onResumeMatch?: () => void;
  onSelectHost: (host: string) => void;
  onCopy: () => Promise<boolean>;
  onBack: () => void;
};

function hostStartBlockHint(
  seats: LobbySeat[],
  capabilities: CapabilityReport | null,
): string | null {
  const structural = lobbyStartBlockHint(seats);
  if (structural) return structural;
  for (const seat of seats) {
    if (seat.kind !== "local_agent") continue;
    const cli = (seat.cli as AgentCli | null) ?? "stub";
    const status = seatReadiness(
      { cli, modelId: seat.modelId ?? "" },
      capabilities,
    );
    if (status !== "ready") {
      return `座位 ${seat.seatId} 的 Agent 未就绪，请重新检测。`;
    }
  }
  return null;
}

export function HostInvitePanel({
  room,
  seats,
  mySeatId,
  busy,
  probing,
  capabilities,
  displayNameDraft,
  onDisplayNameDraftChange,
  onRename,
  onConfigure,
  onProbe,
  onStart,
  onResumeMatch,
  onSelectHost,
  onCopy,
  onBack,
}: HostInvitePanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const inMatch = room.phase === "match";
  const gate = inMatch ? null : hostStartBlockHint(seats, capabilities);
  const canStart = gate === null;

  async function handleCopy() {
    let copied = false;
    try {
      copied = await onCopy();
    } catch {
      copied = false;
    }
    setCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), 2200);
  }

  return (
    <section className="panel host-console" aria-label="主机大厅">
      <button type="button" className="ghost" disabled={busy} onClick={onBack}>
        ← 返回入口
      </button>

      <div className="host-console-grid">
        <div className="host-console-invite">
          <p className="eyebrow">主机大厅 · 邀请与开局</p>
          <p className="code-xl">{room.code}</p>
          {room.joinUrl ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCopy()}
              >
                {copyState === "copied" ? "已复制" : "复制加入链接"}
              </button>
              <code className="join-url">{room.joinUrl}</code>
              {copyState === "failed" ? (
                <p className="hint">自动复制失败，请手动选择下方链接。</p>
              ) : null}
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
              <>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || probing}
                  onClick={onProbe}
                >
                  {probing ? "检测中…" : "重新检测 Agent"}
                </button>
                <button
                  type="button"
                  disabled={busy || !canStart}
                  onClick={onStart}
                >
                  开始对局
                </button>
              </>
            )}
          </div>
          {inMatch ? (
            <p className="hint ok">对局进行中，座位配置已锁定。</p>
          ) : gate ? (
            <p className="hint">{gate}</p>
          ) : (
            <p className="hint ok">
              门禁通过：有效座 2–6，无开放空槽，Agent 就绪。点开始时服务端复检。
            </p>
          )}
          <p className="fine">
            不强制已有远程人类；可先开「主机 + Agent」。端口 {room.port}。
          </p>
        </div>

        <div className="host-console-seats">
          <h3 className="lobby-seats-heading">座位矩阵</h3>
          <LobbySeatList
            seats={seats}
            mySeatId={mySeatId}
            busy={busy}
            capabilities={capabilities}
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
