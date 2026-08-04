import type { LobbySeat } from "./lanRoom";
import { seatKindLabel } from "./lanRoom";
import type { CapabilityReport } from "./matchSetup";
import {
  defaultAgentDisplayName,
  modelsForCli,
  type AgentCli,
} from "./matchSetup";

export type HostSeatConfig =
  | { kind: "open" }
  | { kind: "closed" }
  | {
      kind: "local_agent";
      displayName: string;
      cli: AgentCli;
      modelId: string | null;
    };

type LobbySeatListProps = {
  seats: LobbySeat[];
  mySeatId: string | null;
  busy: boolean;
  /** When set, open seats show a claim control. */
  onClaim?: (seatId: string) => void;
  /** Host-only: configure seats 2–6. */
  onConfigure?: (seatId: string, config: HostSeatConfig) => void;
  capabilities?: CapabilityReport | null;
  displayNameDraft: string;
  onDisplayNameDraftChange: (value: string) => void;
  onRename?: () => void;
};

export function LobbySeatList({
  seats,
  mySeatId,
  busy,
  onClaim,
  onConfigure,
  capabilities,
  displayNameDraft,
  onDisplayNameDraftChange,
  onRename,
}: LobbySeatListProps) {
  return (
    <div className="lobby-seats" aria-label="座位">
      <ul className="lobby-seat-list">
        {seats.map((seat, index) => {
          const mine = mySeatId === seat.seatId;
          const configurable =
            Boolean(onConfigure) &&
            seat.kind !== "local_human" &&
            seat.seatId !== "1";
          const configValue =
            seat.kind === "local_agent"
              ? "local_agent"
              : seat.kind === "closed"
                ? "closed"
                : seat.kind === "remote_human"
                  ? "remote_human"
                  : "open";
          return (
            <li
              key={seat.seatId}
              className={`lobby-seat${mine ? " mine" : ""}${
                configurable ? " configurable" : ""
              }`}
            >
              <span className="lobby-seat-id">座 {seat.seatId}</span>
              <span className="lobby-seat-kind">{seatKindLabel(seat.kind)}</span>
              <span className="lobby-seat-name">
                {seat.displayName ?? "—"}
                {mine ? "（你）" : ""}
                {seat.kind === "local_agent" && seat.cli
                  ? ` · ${seat.cli}${seat.modelId ? ` / ${seat.modelId}` : ""}`
                  : ""}
              </span>
              {onClaim && seat.kind === "open" ? (
                <button
                  type="button"
                  disabled={busy || Boolean(mySeatId)}
                  onClick={() => onClaim(seat.seatId)}
                >
                  占座
                </button>
              ) : null}
              {configurable && onConfigure ? (
                <div className="lobby-seat-config">
                  <select
                    aria-label={`座位 ${seat.seatId} 类型`}
                    disabled={busy}
                    value={configValue}
                    onChange={(event) => {
                      const kind = event.target.value;
                      if (kind === "open") {
                        onConfigure(seat.seatId, { kind: "open" });
                      } else if (kind === "closed") {
                        onConfigure(seat.seatId, { kind: "closed" });
                      } else if (kind === "local_agent") {
                        const cli = (seat.cli as AgentCli) || "stub";
                        const models = modelsForCli(cli, capabilities ?? null);
                        onConfigure(seat.seatId, {
                          kind: "local_agent",
                          displayName:
                            seat.displayName ??
                            defaultAgentDisplayName(index - 1),
                          cli,
                          modelId: seat.modelId ?? models[0]?.id ?? null,
                        });
                      }
                    }}
                  >
                    {seat.kind === "remote_human" ? (
                      <option value="remote_human" disabled>
                        已占（远程）
                      </option>
                    ) : null}
                    <option value="open">开放占座</option>
                    <option value="local_agent">本机 Agent</option>
                    <option value="closed">关闭</option>
                  </select>
                  {seat.kind === "local_agent" ? (
                    <>
                      <select
                        aria-label={`座位 ${seat.seatId} CLI`}
                        disabled={busy}
                        value={seat.cli ?? "stub"}
                        onChange={(event) => {
                          const cli = event.target.value as AgentCli;
                          const models = modelsForCli(cli, capabilities ?? null);
                          onConfigure(seat.seatId, {
                            kind: "local_agent",
                            displayName:
                              seat.displayName ??
                              defaultAgentDisplayName(index - 1),
                            cli,
                            modelId: models[0]?.id ?? null,
                          });
                        }}
                      >
                        <option value="stub">Stub</option>
                        <option value="opencode">OpenCode</option>
                        <option value="claude">Claude</option>
                      </select>
                      <select
                        aria-label={`座位 ${seat.seatId} 模型`}
                        disabled={busy}
                        value={seat.modelId ?? ""}
                        onChange={(event) => {
                          onConfigure(seat.seatId, {
                            kind: "local_agent",
                            displayName:
                              seat.displayName ??
                              defaultAgentDisplayName(index - 1),
                            cli: (seat.cli as AgentCli) || "stub",
                            modelId: event.target.value || null,
                          });
                        }}
                      >
                        {modelsForCli(
                          (seat.cli as AgentCli) || "stub",
                          capabilities ?? null,
                        ).map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {mySeatId ? (
        <label className="field">
          显示名
          <span className="lobby-rename-row">
            <input
              value={displayNameDraft}
              disabled={busy}
              maxLength={24}
              onChange={(event) => onDisplayNameDraftChange(event.target.value)}
            />
            {onRename ? (
              <button type="button" disabled={busy} onClick={onRename}>
                改名
              </button>
            ) : null}
          </span>
        </label>
      ) : null}
    </div>
  );
}
