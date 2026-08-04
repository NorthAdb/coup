import { useEffect, useState } from "react";
import type { LegalDecision, SeatView } from "@coup/protocol";
import { MatchDesk } from "./MatchDesk";
import { SetupPage } from "./SetupPage";
import type { DecisionRationaleView } from "./matchCopy";
import {
  buildCreateMatchPayload,
  loadSetupDraft,
  reconcileDraftModels,
  saveSetupDraft,
  type CapabilityReport,
  type MatchSetupDraft,
} from "./matchSetup";

type AgentPhase = "idle" | "thinking" | "validating" | "retrying" | "failed";

export function App() {
  const [view, setView] = useState<SeatView | null>(null);
  const [decisionRationales, setDecisionRationales] = useState<
    Record<string, DecisionRationaleView>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>("idle");
  const [setupDraft, setSetupDraft] = useState<MatchSetupDraft>(() =>
    loadSetupDraft(),
  );
  const [capabilities, setCapabilities] = useState<CapabilityReport | null>(
    null,
  );
  const [probing, setProbing] = useState(false);
  const [resumableMatchId, setResumableMatchId] = useState<string | null>(null);
  const [matches, setMatches] = useState<
    Array<{
      matchId: string;
      runStatus: string;
      winnerSeatId: string | null;
      resumedFromMatchId: string | null;
      stateVersion: number;
    }>
  >([]);
  const [eventBrowse, setEventBrowse] = useState<{
    matchId: string;
    runStatus: string;
    events: Array<{ seq: number; event: { type: string } }>;
  } | null>(null);

  useEffect(() => {
    if (!busy || !view) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch("/api/matches/current/agent-phase");
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { phase?: AgentPhase };
        if (body.phase && !cancelled) {
          setAgentPhase(body.phase);
        }
      } catch {
        /* ignore polling errors */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [busy, view]);

  async function refreshMatchList() {
    try {
      const response = await fetch("/api/matches");
      if (!response.ok) return;
      const body = (await response.json()) as {
        matches: Array<{
          matchId: string;
          runStatus: string;
          winnerSeatId: string | null;
          resumedFromMatchId: string | null;
          stateVersion: number;
        }>;
      };
      setMatches(body.matches);
    } catch {
      // ignore list failures on setup
    }
  }

  async function refreshCapabilities() {
    setProbing(true);
    setError(null);
    try {
      const response = await fetch("/api/capabilities");
      if (!response.ok) {
        throw new Error("能力探测失败");
      }
      const body = (await response.json()) as CapabilityReport;
      setCapabilities(body);
      setSetupDraft((current) => {
        const next = reconcileDraftModels(current, body);
        saveSetupDraft(next);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "能力探测失败");
    } finally {
      setProbing(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/matches/current");
        if (response.ok) {
          const body = (await response.json()) as {
            view: SeatView;
            matchId: string;
            decisionRationales?: Record<string, DecisionRationaleView>;
          };
          setView(body.view);
          setDecisionRationales(body.decisionRationales ?? {});
          setResumableMatchId(body.matchId);
          return;
        }
        setResumableMatchId(null);
      } catch {
        setResumableMatchId(null);
      }
      await refreshCapabilities();
      await refreshMatchList();
    })();
  }, []);

  function updateSetupDraft(draft: MatchSetupDraft) {
    setSetupDraft(draft);
    saveSetupDraft(draft);
  }

  async function continueMatch() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/matches/current");
      if (!response.ok) {
        setResumableMatchId(null);
        throw new Error("没有可继续的对局");
      }
      const body = (await response.json()) as {
        view: SeatView;
        matchId: string;
        decisionRationales?: Record<string, DecisionRationaleView>;
      };
      setView(body.view);
      setDecisionRationales(body.decisionRationales ?? {});
      setResumableMatchId(body.matchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法继续对局");
      await refreshMatchList();
    } finally {
      setBusy(false);
    }
  }

  async function browseEvents(matchId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/matches/${matchId}/events`);
      if (!response.ok) {
        throw new Error("无法加载事件列表");
      }
      const body = (await response.json()) as {
        matchId: string;
        runStatus: string;
        events: Array<{ seq: number; event: { type: string } }>;
      };
      setEventBrowse(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载事件列表");
    } finally {
      setBusy(false);
    }
  }

  async function resumeMatch(matchId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/matches/${matchId}/resume`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "无法从快照恢复");
      }
      const body = (await response.json()) as {
        view: SeatView;
        resumedFromMatchId: string;
        decisionRationales?: Record<string, DecisionRationaleView>;
      };
      setView(body.view);
      setDecisionRationales(body.decisionRationales ?? {});
      setResumableMatchId(body.view.matchId);
      setEventBrowse(null);
      await refreshMatchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
      await refreshMatchList();
    } finally {
      setBusy(false);
    }
  }

  async function startMatch() {
    setBusy(true);
    setError(null);
    saveSetupDraft(setupDraft);
    try {
      const response = await fetch("/api/matches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCreateMatchPayload(setupDraft)),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          hint?: string;
          aborted?: boolean;
          matchId?: string | null;
        } | null;
        void refreshCapabilities();
        await refreshMatchList();
        throw new Error(body?.hint ?? body?.error ?? "无法创建对局");
      }
      const body = (await response.json()) as {
        view: SeatView;
        decisionRationales?: Record<string, DecisionRationaleView>;
      };
      setView(body.view);
      setDecisionRationales(body.decisionRationales ?? {});
      setResumableMatchId(body.view.matchId);
      setEventBrowse(null);
      await refreshMatchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  function returnToSetup() {
    // Clear client view only; server keeps the in-progress run for resume.
    setView(null);
    setDecisionRationales({});
    setError(null);
    void (async () => {
      try {
        const response = await fetch("/api/matches/current");
        if (response.ok) {
          const body = (await response.json()) as { matchId: string };
          setResumableMatchId(body.matchId);
        } else {
          setResumableMatchId(null);
        }
      } catch {
        setResumableMatchId(null);
      }
      await refreshCapabilities();
      await refreshMatchList();
    })();
  }

  async function submitDecision(decision: LegalDecision, label: string) {
    if (!view) return;
    setBusy(true);
    setAgentPhase("thinking");
    setError(null);
    try {
      const response = await fetch("/api/matches/current/decision", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          requestId: `req-${view.stateVersion}-${label}`,
          stateVersion: view.stateVersion,
          decision,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          aborted?: boolean;
          matchId?: string;
        } | null;
        if (body?.aborted && body.matchId) {
          setView(null);
          setDecisionRationales({});
          setResumableMatchId(null);
          setAgentPhase("failed");
          await refreshMatchList();
          throw new Error(
            `技术中止（无胜者）：${body.error ?? "agent_failed"}。可在开局页从快照恢复。`,
          );
        }
        throw new Error(body?.error ?? "提交失败");
      }
      const body = (await response.json()) as {
        view: SeatView;
        decisionRationales?: Record<string, DecisionRationaleView>;
      };
      setView(body.view);
      setDecisionRationales(body.decisionRationales ?? {});
      setAgentPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  if (view) {
    return (
      <>
        <MatchDesk
          view={view}
          busy={busy}
          agentPhase={agentPhase}
          decisionRationales={decisionRationales}
          onSubmitDecision={(decision, label) =>
            void submitDecision(decision, label)
          }
          onReturnToSetup={returnToSetup}
        />
        {error ? <p className="desk-error">{error}</p> : null}
      </>
    );
  }

  return (
    <main className="shell">
      <header className="top">
        <p className="eyebrow">本机自用</p>
        <h1>政变</h1>
        <p className="lede">
          配置 2–6 人桌：座位 1 固定为你，其余 Agent 座位选择 CLI 与模型后开局。
        </p>
      </header>

      <SetupPage
        draft={setupDraft}
        capabilities={capabilities}
        probing={probing}
        busy={busy}
        resumableMatchId={resumableMatchId}
        matches={matches}
        eventBrowse={eventBrowse}
        onChange={updateSetupDraft}
        onStart={() => void startMatch()}
        onProbe={() => void refreshCapabilities()}
        onContinue={() => void continueMatch()}
        onBrowseEvents={(matchId) => void browseEvents(matchId)}
        onResume={(matchId) => void resumeMatch(matchId)}
      />

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
