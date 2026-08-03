import type { CliRunner } from "./agents/types.js";

export type ProbeCliKind = "opencode" | "claude";

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
  cli: ProbeCliKind;
  status: CapabilityStatus;
  version: string | null;
  models: DiscoveredModel[];
  hint: string;
};

export type CapabilityReport = {
  clis: Record<ProbeCliKind, CliCapability>;
};

export type SeatReadinessStatus =
  | CapabilityStatus
  | "model_invalid"
  | "probing";

/** CLI aliases documented by Claude Code help; no account model catalog via CLI. */
export const CLAUDE_ALIAS_MODELS: DiscoveredModel[] = [
  { id: "sonnet", label: "Sonnet（CLI 别名）" },
  { id: "opus", label: "Opus（CLI 别名）" },
  { id: "haiku", label: "Haiku（CLI 别名）" },
];

const OPENCODE_MIN = { major: 1, minor: 0, patch: 0 };
const CLAUDE_MIN = { major: 2, minor: 0, patch: 0 };

export type CapabilityProbeOptions = {
  runner: CliRunner;
  opencodeCommand?: string;
  claudeCommand?: string;
};

export async function probeCapabilities(
  options: CapabilityProbeOptions,
): Promise<CapabilityReport> {
  const [opencode, claude] = await Promise.all([
    probeOpenCode(options),
    probeClaude(options),
  ]);
  return { clis: { opencode, claude } };
}

export async function probeOpenCode(
  options: CapabilityProbeOptions,
): Promise<CliCapability> {
  const command = options.opencodeCommand ?? "opencode";
  const versionResult = await runQuiet(options.runner, {
    command,
    args: ["--version"],
  });
  if (!versionResult.ok) {
    return capability("opencode", "not_installed", null, [], hintFor("opencode", "not_installed"));
  }

  const version = parseVersionLine(versionResult.stdout);
  if (!version || !versionAtLeast(version, OPENCODE_MIN)) {
    return capability(
      "opencode",
      "unsupported_version",
      version?.raw ?? null,
      [],
      hintFor("opencode", "unsupported_version"),
    );
  }

  const auth = await runQuiet(options.runner, {
    command,
    args: ["providers", "list"],
  });
  if (!auth.ok) {
    return capability(
      "opencode",
      "not_authenticated",
      version.raw,
      [],
      hintFor("opencode", "not_authenticated"),
    );
  }

  const modelsResult = await runQuiet(options.runner, {
    command,
    args: ["models"],
  });
  const models = modelsResult.ok
    ? parseOpenCodeModels(modelsResult.stdout)
    : [];
  if (models.length === 0) {
    return capability(
      "opencode",
      "no_models",
      version.raw,
      [],
      hintFor("opencode", "no_models"),
    );
  }

  return capability("opencode", "ready", version.raw, models, hintFor("opencode", "ready"));
}

export async function probeClaude(
  options: CapabilityProbeOptions,
): Promise<CliCapability> {
  const command = options.claudeCommand ?? "claude";
  const versionResult = await runQuiet(options.runner, {
    command,
    args: ["--version"],
  });
  if (!versionResult.ok) {
    return capability("claude", "not_installed", null, [], hintFor("claude", "not_installed"));
  }

  const version = parseVersionLine(versionResult.stdout);
  if (!version || !versionAtLeast(version, CLAUDE_MIN)) {
    return capability(
      "claude",
      "unsupported_version",
      version?.raw ?? null,
      [],
      hintFor("claude", "unsupported_version"),
    );
  }

  const auth = await runQuiet(options.runner, {
    command,
    args: ["auth", "status"],
  });
  if (!isClaudeAuthenticated(auth)) {
    return capability(
      "claude",
      "not_authenticated",
      version.raw,
      [],
      hintFor("claude", "not_authenticated"),
    );
  }

  // No CLI model catalog; expose documented aliases only when auth is ready.
  const models = CLAUDE_ALIAS_MODELS;
  return capability("claude", "ready", version.raw, models, hintFor("claude", "ready"));
}

export function seatReadiness(
  capability: CliCapability | undefined,
  modelId: string,
): SeatReadinessStatus {
  if (!capability) return "probing";
  if (capability.status !== "ready") return capability.status;
  if (!capability.models.some((model) => model.id === modelId)) {
    return "model_invalid";
  }
  return "ready";
}

export type SetupSeatProbeInput = {
  cli?: string | null;
  modelId?: string | null;
};

/**
 * Light start-time recheck: stub seats pass; real CLI seats must be ready
 * with a currently listed model.
 */
export function recheckSetupSeats(
  seats: SetupSeatProbeInput[],
  report: CapabilityReport,
): { ok: true } | { ok: false; reason: string; hint: string } {
  for (const seat of seats) {
    const cli = seat.cli ?? "stub";
    if (cli === "stub" || cli == null) continue;
    if (cli !== "opencode" && cli !== "claude") {
      return {
        ok: false,
        reason: "invalid_cli",
        hint: "未知的 CLI 类型。",
      };
    }
    const modelId = seat.modelId ?? "";
    const capability = report.clis[cli];
    const status = seatReadiness(capability, modelId);
    if (status === "ready") continue;
    return {
      ok: false,
      reason: `seat_not_ready:${status}`,
      hint:
        status === "model_invalid"
          ? `所选模型已失效，请重新选择 ${cli === "opencode" ? "OpenCode" : "Claude Code"} 模型。`
          : capability.hint,
    };
  }
  return { ok: true };
}

export function sanitizeCapabilityReport(
  report: CapabilityReport,
): CapabilityReport {
  return {
    clis: {
      opencode: sanitizeCliCapability(report.clis.opencode),
      claude: sanitizeCliCapability(report.clis.claude),
    },
  };
}

function sanitizeCliCapability(capability: CliCapability): CliCapability {
  return {
    cli: capability.cli,
    status: capability.status,
    version: capability.version,
    models: capability.models.map((model) => ({
      id: model.id,
      label: model.label,
    })),
    hint: capability.hint,
  };
}

function capability(
  cli: ProbeCliKind,
  status: CapabilityStatus,
  version: string | null,
  models: DiscoveredModel[],
  hint: string,
): CliCapability {
  return { cli, status, version, models, hint };
}

function hintFor(cli: ProbeCliKind, status: CapabilityStatus): string {
  const name = cli === "opencode" ? "OpenCode" : "Claude Code";
  switch (status) {
    case "ready":
      return `${name} 已就绪。`;
    case "not_installed":
      return `未检测到 ${name} CLI。请先安装并确保可在终端直接运行。`;
    case "unsupported_version":
      return `${name} 版本过低或不被识别。请升级后再试。`;
    case "not_authenticated":
      return `${name} 尚未登录。请在终端完成对应 CLI 登录后点「重新检测」。`;
    case "no_models":
      return `${name} 已安装但没有可用模型。请检查 provider / 账号配置后重新检测。`;
  }
}

type QuietResult =
  | { ok: true; stdout: string; exitCode: number }
  | { ok: false; stdout: string; exitCode: number };

async function runQuiet(
  runner: CliRunner,
  request: { command: string; args: string[] },
): Promise<QuietResult> {
  try {
    const result = await runner({
      command: request.command,
      args: request.args,
      cwd: process.cwd(),
    });
    if (result.exitCode !== 0) {
      return { ok: false, stdout: result.stdout, exitCode: result.exitCode };
    }
    return { ok: true, stdout: result.stdout, exitCode: result.exitCode };
  } catch {
    return { ok: false, stdout: "", exitCode: 1 };
  }
}

type ParsedVersion = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
};

function parseVersionLine(stdout: string): ParsedVersion | null {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return null;
  const match = line.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    raw: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function versionAtLeast(
  version: ParsedVersion,
  min: { major: number; minor: number; patch: number },
): boolean {
  if (version.major !== min.major) return version.major > min.major;
  if (version.minor !== min.minor) return version.minor > min.minor;
  return version.patch >= min.patch;
}

export function parseOpenCodeModels(stdout: string): DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // Strip ANSI / noisy prefixes; keep provider/model tokens.
    const cleaned = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
    const idMatch = cleaned.match(/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/);
    if (!idMatch) continue;
    const id = idMatch[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const slash = id.indexOf("/");
    const provider = id.slice(0, slash);
    const model = id.slice(slash + 1);
    models.push({ id, label: `${model}（${provider}）` });
  }
  return models;
}

/**
 * Auth probe: prefer boolean `loggedIn` when JSON is present; otherwise exit
 * code. Never expose authMethod / keys / account fields to callers.
 */
export function isClaudeAuthenticated(result: QuietResultLike): boolean {
  const loggedIn = readLoggedInFlag(result.stdout);
  if (loggedIn !== null) return loggedIn;
  return result.ok && result.exitCode === 0;
}

type QuietResultLike = {
  ok: boolean;
  stdout: string;
  exitCode: number;
};

function readLoggedInFlag(stdout: string): boolean | null {
  const text = stdout.trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text) as { loggedIn?: unknown };
    return typeof parsed.loggedIn === "boolean" ? parsed.loggedIn : null;
  } catch {
    return null;
  }
}
