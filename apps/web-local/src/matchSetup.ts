export type AgentCli = "opencode" | "claude" | "stub";

export type AgentSeatDraft = {
  cli: AgentCli;
  modelId: string;
};

export type MatchSetupDraft = {
  seatCount: number;
  agents: AgentSeatDraft[];
};

export type CapabilityStatus =
  | "ready"
  | "not_installed"
  | "unsupported_version"
  | "not_authenticated"
  | "no_models";

export type DiscoveredModel = {
  id: string;
  label: string;
};

export type CliCapability = {
  cli: "opencode" | "claude";
  status: CapabilityStatus;
  version: string | null;
  models: DiscoveredModel[];
  hint: string;
};

export type CapabilityReport = {
  clis: {
    opencode: CliCapability;
    claude: CliCapability;
  };
};

export type SeatReadinessStatus =
  | CapabilityStatus
  | "model_invalid"
  | "probing"
  | "ready";

export const SETUP_STORAGE_KEY = "coup.matchSetup.v1";

export const AGENT_DISPLAY_NAMES = [
  "灰狐",
  "白塔",
  "夜枭",
  "暗羽",
  "赤砂",
] as const;

export const STUB_MODELS: DiscoveredModel[] = [
  { id: "stub/placeholder", label: "本地 Stub" },
];

export function defaultAgentDisplayName(agentIndex: number): string {
  return AGENT_DISPLAY_NAMES[agentIndex] ?? `Agent ${agentIndex + 1}`;
}

export function defaultSetup(seatCount = 2): MatchSetupDraft {
  const count = Math.min(6, Math.max(2, seatCount));
  const agents: AgentSeatDraft[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    agents.push({
      cli: "stub",
      modelId: STUB_MODELS[0]!.id,
    });
  }
  return { seatCount: count, agents };
}

export function modelsForCli(
  cli: AgentCli,
  report: CapabilityReport | null,
): DiscoveredModel[] {
  if (cli === "stub") return STUB_MODELS;
  if (!report) return [];
  return report.clis[cli].models;
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
      const modelId =
        typeof saved.modelId === "string" && saved.modelId.length > 0
          ? saved.modelId
          : fallback.modelId;
      return { cli, modelId };
    });
    return { seatCount: base.seatCount, agents };
  } catch {
    return defaultSetup();
  }
}

/** After a fresh probe, drop invalid model ids onto the first discovered model. */
export function reconcileDraftModels(
  draft: MatchSetupDraft,
  report: CapabilityReport,
): MatchSetupDraft {
  const agents = draft.agents.map((agent) => {
    const models = modelsForCli(agent.cli, report);
    if (models.length === 0) return agent;
    if (models.some((model) => model.id === agent.modelId)) return agent;
    return { ...agent, modelId: models[0]!.id };
  });
  return { ...draft, agents };
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

export function seatReadiness(
  agent: AgentSeatDraft,
  report: CapabilityReport | null,
): SeatReadinessStatus {
  if (agent.cli === "stub") {
    return STUB_MODELS.some((model) => model.id === agent.modelId)
      ? "ready"
      : "model_invalid";
  }
  if (!report) return "probing";
  const capability = report.clis[agent.cli];
  if (capability.status !== "ready") return capability.status;
  if (!capability.models.some((model) => model.id === agent.modelId)) {
    return "model_invalid";
  }
  return "ready";
}

export function readinessLabel(status: SeatReadinessStatus): string {
  switch (status) {
    case "ready":
      return "就绪";
    case "not_installed":
      return "未安装";
    case "unsupported_version":
      return "版本不支持";
    case "not_authenticated":
      return "未认证";
    case "no_models":
      return "无可用模型";
    case "model_invalid":
      return "所选模型已失效";
    case "probing":
      return "探测中";
  }
}

export function seatHint(
  agent: AgentSeatDraft,
  report: CapabilityReport | null,
): string {
  const status = seatReadiness(agent, report);
  if (status === "ready") {
    return agent.cli === "stub"
      ? "本地 Stub，无需 CLI。"
      : (report?.clis[agent.cli].hint ?? "已就绪。");
  }
  if (status === "probing") return "正在探测本机 CLI…";
  if (status === "model_invalid") {
    return "所选模型已不在探测结果中，请另选或重新检测。";
  }
  if (!report || agent.cli === "stub") return "请检查配置。";
  return report.clis[agent.cli].hint;
}

export function setupReady(
  draft: MatchSetupDraft,
  report: CapabilityReport | null,
): boolean {
  if (draft.seatCount < 2 || draft.seatCount > 6) return false;
  if (draft.agents.length !== draft.seatCount - 1) return false;
  if (!report) return false;
  return draft.agents.every(
    (agent) => seatReadiness(agent, report) === "ready",
  );
}

export function setupBlockHint(
  draft: MatchSetupDraft,
  report: CapabilityReport | null,
): string | null {
  if (setupReady(draft, report)) return null;
  if (!report) return "正在探测本机 CLI，请稍候…";
  for (const agent of draft.agents) {
    const status = seatReadiness(agent, report);
    if (status !== "ready") return seatHint(agent, report);
  }
  return "请为每个 Agent 座位选择 CLI 与模型后再开始。";
}
