export type AgentCli = "opencode" | "claude" | "stub";

export type AgentSeatDraft = {
  cli: AgentCli;
  modelId: string;
};

export type MatchSetupDraft = {
  seatCount: number;
  agents: AgentSeatDraft[];
};

export const SETUP_STORAGE_KEY = "coup.matchSetup.v1";

export const AGENT_DISPLAY_NAMES = [
  "灰狐",
  "白塔",
  "夜枭",
  "暗羽",
  "赤砂",
] as const;

export const PLACEHOLDER_MODELS: Record<
  AgentCli,
  Array<{ id: string; label: string }>
> = {
  opencode: [{ id: "opencode/placeholder", label: "CLI 默认模型" }],
  claude: [{ id: "claude/placeholder", label: "CLI 默认模型" }],
  stub: [{ id: "stub/placeholder", label: "本地 Stub" }],
};

export function defaultAgentDisplayName(agentIndex: number): string {
  return AGENT_DISPLAY_NAMES[agentIndex] ?? `Agent ${agentIndex + 1}`;
}

export function defaultSetup(seatCount = 2): MatchSetupDraft {
  const count = Math.min(6, Math.max(2, seatCount));
  const agents: AgentSeatDraft[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    agents.push({
      cli: "stub",
      modelId: PLACEHOLDER_MODELS.stub[0]!.id,
    });
  }
  return { seatCount: count, agents };
}

export function loadSetupDraft(): MatchSetupDraft {
  try {
    const raw = localStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return defaultSetup();
    const parsed = JSON.parse(raw) as Partial<MatchSetupDraft>;
    if (
      typeof parsed.seatCount !== "number" ||
      !Array.isArray(parsed.agents)
    ) {
      return defaultSetup();
    }
    const base = defaultSetup(parsed.seatCount);
    const agents = base.agents.map((fallback, index) => {
      const saved = parsed.agents?.[index];
      if (!saved) return fallback;
      const cli: AgentCli =
        saved.cli === "claude" ||
        saved.cli === "opencode" ||
        saved.cli === "stub"
          ? saved.cli
          : fallback.cli;
      const models = PLACEHOLDER_MODELS[cli];
      const modelId =
        typeof saved.modelId === "string" &&
        models.some((model) => model.id === saved.modelId)
          ? saved.modelId
          : models[0]!.id;
      return { cli, modelId };
    });
    return { seatCount: base.seatCount, agents };
  } catch {
    return defaultSetup();
  }
}

export function saveSetupDraft(draft: MatchSetupDraft): void {
  localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(draft));
}

export function buildCreateMatchPayload(draft: MatchSetupDraft) {
  return {
    seats: [
      {
        seatId: "seat-1",
        controller: "local_human" as const,
        displayName: "你",
      },
      ...draft.agents.map((agent, index) => ({
        seatId: `seat-${index + 2}`,
        controller: "stub_agent" as const,
        displayName: defaultAgentDisplayName(index),
        cli: agent.cli,
        modelId: agent.modelId,
      })),
    ],
  };
}

/** Until ticket 19: selecting a CLI + model is enough to enable start. */
export function setupReady(draft: MatchSetupDraft): boolean {
  if (draft.seatCount < 2 || draft.seatCount > 6) return false;
  if (draft.agents.length !== draft.seatCount - 1) return false;
  return draft.agents.every((agent) => {
    const models = PLACEHOLDER_MODELS[agent.cli];
    return models.some((model) => model.id === agent.modelId);
  });
}
