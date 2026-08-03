import {
  AGENT_DISPLAY_NAMES,
  PLACEHOLDER_MODELS,
  setupReady,
  type AgentCli,
  type MatchSetupDraft,
} from "./matchSetup";

type SetupPageProps = {
  draft: MatchSetupDraft;
  busy: boolean;
  onChange: (draft: MatchSetupDraft) => void;
  onStart: () => void;
};

export function SetupPage({
  draft,
  busy,
  onChange,
  onStart,
}: SetupPageProps) {
  const canStart = setupReady(draft) && !busy;

  function setSeatCount(seatCount: number) {
    const agents = [...draft.agents];
    while (agents.length < seatCount - 1) {
      const index = agents.length;
      const cli: AgentCli = index % 2 === 0 ? "opencode" : "claude";
      agents.push({
        cli,
        modelId: PLACEHOLDER_MODELS[cli][0]!.id,
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
        next.modelId = PLACEHOLDER_MODELS[patch.cli][0]!.id;
      }
      return next;
    });
    onChange({ ...draft, agents });
  }

  return (
    <section className="panel setup" aria-label="开局配置">
      <p className="boundary">
        本机自用 MVP：复用本机已安装 OpenCode / Claude Code
        的登录状态；应用内不配置、不存储 API key。真 CLI
        探测与模型目录由后续能力探测接入；当前 Agent 座位以 Stub
        占位开局。
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
          const models = PLACEHOLDER_MODELS[agent.cli];
          return (
            <li key={`agent-${index}`} className="setup-seat">
              <div className="setup-seat-head">
                <strong>
                  座位 {index + 2} ·{" "}
                  {AGENT_DISPLAY_NAMES[index] ?? `Agent ${index + 1}`}
                </strong>
                <span className="status ready">Stub 占位 · 就绪</span>
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
                    <option value="opencode">OpenCode</option>
                    <option value="claude">Claude Code</option>
                  </select>
                </label>
                <label>
                  模型
                  <select
                    value={agent.modelId}
                    disabled={busy}
                    onChange={(event) =>
                      updateAgent(index, { modelId: event.target.value })
                    }
                  >
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="meta">
                顺时针第 {index + 2} 席；所选 CLI/模型将记住，真探测接入前以
                Stub 对弈。
              </p>
            </li>
          );
        })}
      </ol>

      <div className="setup-actions">
        <button type="button" disabled={!canStart} onClick={() => onStart()}>
          开始对局
        </button>
        {!canStart && !busy ? (
          <p className="hint">请为每个 Agent 座位选择 CLI 与模型后再开始。</p>
        ) : (
          <p className="hint">本地玩家固定先手，其余按座位列表顺时针行动。</p>
        )}
      </div>
    </section>
  );
}
