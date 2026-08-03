import {
  AGENT_DISPLAY_NAMES,
  modelsForCli,
  readinessLabel,
  seatHint,
  seatReadiness,
  setupBlockHint,
  setupReady,
  STUB_MODELS,
  type AgentCli,
  type CapabilityReport,
  type MatchSetupDraft,
} from "./matchSetup";

type SetupPageProps = {
  draft: MatchSetupDraft;
  capabilities: CapabilityReport | null;
  probing: boolean;
  busy: boolean;
  onChange: (draft: MatchSetupDraft) => void;
  onStart: () => void;
  onProbe: () => void;
};

export function SetupPage({
  draft,
  capabilities,
  probing,
  busy,
  onChange,
  onStart,
  onProbe,
}: SetupPageProps) {
  const canStart = setupReady(draft, capabilities) && !busy && !probing;
  const blockHint = setupBlockHint(draft, capabilities);

  function setSeatCount(seatCount: number) {
    const agents = [...draft.agents];
    while (agents.length < seatCount - 1) {
      agents.push({
        cli: "stub",
        modelId: STUB_MODELS[0]!.id,
      });
    }
    onChange({
      seatCount,
      agents: agents.slice(0, seatCount - 1),
    });
  }

  function updateAgent(
    index: number,
    patch: Partial<MatchSetupDraft["agents"][number]>,
  ) {
    const agents = draft.agents.map((agent, agentIndex) => {
      if (agentIndex !== index) return agent;
      const next = { ...agent, ...patch };
      if (patch.cli && patch.cli !== agent.cli) {
        const models = modelsForCli(patch.cli, capabilities);
        next.modelId = models[0]?.id ?? "";
      }
      return next;
    });
    onChange({ ...draft, agents });
  }

  return (
    <section className="panel setup" aria-label="开局配置">
      <p className="boundary">
        本机自用 MVP：复用本机已安装 OpenCode / Claude Code
        的登录状态；应用内不配置、不存储 API
        key。探测只返回脱敏就绪状态与模型目录。
      </p>

      <div className="setup-row">
        <label htmlFor="seat-count">总人数</label>
        <select
          id="seat-count"
          value={draft.seatCount}
          disabled={busy}
          onChange={(event) => setSeatCount(Number(event.target.value))}
        >
          {[2, 3, 4, 5, 6].map((count) => (
            <option key={count} value={count}>
              {count} 人
            </option>
          ))}
        </select>
      </div>

      <ol className="setup-seats">
        <li className="setup-seat human">
          <div className="setup-seat-head">
            <strong>座位 1 · 你</strong>
            <span className="status ready">本地玩家 · 先手</span>
          </div>
          <p className="meta">固定本地人类，不可改为 Agent。</p>
        </li>
        {draft.agents.map((agent, index) => {
          const models = modelsForCli(agent.cli, capabilities);
          const status = seatReadiness(agent, capabilities);
          const statusClass =
            status === "ready"
              ? "ready"
              : status === "probing"
                ? "probing"
                : "blocked";
          return (
            <li key={`agent-${index}`} className="setup-seat">
              <div className="setup-seat-head">
                <strong>
                  座位 {index + 2} ·{" "}
                  {AGENT_DISPLAY_NAMES[index] ?? `Agent ${index + 1}`}
                </strong>
                <span className={`status ${statusClass}`}>
                  {agent.cli === "opencode"
                    ? "OpenCode"
                    : agent.cli === "claude"
                      ? "Claude Code"
                      : "Stub"}{" "}
                  · {readinessLabel(status)}
                </span>
              </div>
              <div className="setup-fields">
                <label>
                  CLI
                  <select
                    value={agent.cli}
                    disabled={busy}
                    onChange={(event) =>
                      updateAgent(index, {
                        cli: event.target.value as AgentCli,
                      })
                    }
                  >
                    <option value="stub">Stub（本地回退）</option>
                    <option value="opencode">OpenCode</option>
                    <option value="claude">Claude Code</option>
                  </select>
                </label>
                <label>
                  模型
                  <select
                    value={agent.modelId}
                    disabled={busy || models.length === 0}
                    onChange={(event) =>
                      updateAgent(index, { modelId: event.target.value })
                    }
                  >
                    {models.length === 0 ? (
                      <option value={agent.modelId}>
                        {status === "probing" ? "探测中…" : "无可用模型"}
                      </option>
                    ) : (
                      models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))
                    )}
                  </select>
                </label>
              </div>
              <p className="meta">{seatHint(agent, capabilities)}</p>
            </li>
          );
        })}
      </ol>

      <div className="setup-actions">
        <div className="setup-action-row">
          <button type="button" disabled={!canStart} onClick={() => onStart()}>
            开始对局
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy || probing}
            onClick={() => onProbe()}
          >
            {probing ? "检测中…" : "重新检测"}
          </button>
        </div>
        {blockHint ? (
          <p className="hint">{blockHint}</p>
        ) : (
          <p className="hint">本地玩家固定先手，其余按座位列表顺时针行动。</p>
        )}
      </div>
    </section>
  );
}
