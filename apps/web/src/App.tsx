import { useEffect, useState } from "react";
import type { LegalDecision, SeatView } from "@coup/protocol";
import { MatchDesk } from "./MatchDesk";
import { SetupPage } from "./SetupPage";
import { HomeEntry } from "./HomeEntry";
import { HostInvitePanel } from "./HostInvitePanel";
import { JoinRoomPage } from "./JoinRoomPage";
import { GuestRoomConfirm } from "./GuestRoomConfirm";
import type { DecisionRationaleView } from "./matchCopy";
import {
  buildCreateMatchPayload,
  loadSetupDraft,
  reconcileDraftModels,
  saveSetupDraft,
  type CapabilityReport,
  type MatchSetupDraft,
} from "./matchSetup";
import {
  claimSeat,
  configureLobbySeat,
  createRoomOnCurrentOrigin,
  enterHostModeAndCreateRoom,
  fetchMySeat,
  fetchRoom,
  patchRoomHost,
  postRoomHeartbeat,
  postSeatDisposition,
  renameSeat,
  resumeRoomSeat,
  startRoomMatch,
  type DispositionAction,
  type LobbySeat,
  type RoomInvite,
  type SeatAbsenceView,
} from "./lanRoom";
import type { HostSeatConfig } from "./LobbySeatList";

type AgentPhase =
  | "idle"
  | "thinking"
  | "validating"
  | "retrying"
  | "failed";

type Screen =
  | "home"
  | "local-setup"
  | "host-invite"
  | "join"
  | "guest-confirm";

function initialScreen(): Screen {
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname === "/join" || params.has("code")) {
    return "join";
  }
  return "home";
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() => initialScreen());
  const [room, setRoom] = useState<RoomInvite | null>(null);
  const [lobbySeats, setLobbySeats] = useState<LobbySeat[]>([]);
  const [mySeatId, setMySeatId] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("客人");
  const [guestOrigin, setGuestOrigin] = useState(window.location.origin);
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
  const [absences, setAbsences] = useState<SeatAbsenceView[]>([]);
  const [pausedForAbsenceSeatId, setPausedForAbsenceSeatId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!busy || !view) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch("/api/matches/current/agent-phase");
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          phase?: AgentPhase;
        };
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
      if (sessionStorage.getItem("coup.createRoom") === "1") {
        sessionStorage.removeItem("coup.createRoom");
        setBusy(true);
        try {
          const invite = await createRoomOnCurrentOrigin();
          setRoom(invite);
          setLobbySeats(invite.seats ?? []);
          setMySeatId("1");
          setDisplayNameDraft(
            invite.seats?.find((s) => s.seatId === "1")?.displayName ?? "你",
          );
          setScreen("host-invite");
        } catch (err) {
          setError(err instanceof Error ? err.message : "创建房间失败");
          setScreen("home");
        } finally {
          setBusy(false);
        }
      }

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (
        (window.location.pathname === "/join" || code) &&
        code &&
        /^\d{4}$/.test(code)
      ) {
        try {
          const found = await fetchRoom(window.location.origin, code);
          setRoom(found);
          setLobbySeats(found.seats ?? []);
          setGuestOrigin(window.location.origin);
          const me = await fetchMySeat(window.location.origin, code);
          setMySeatId(me.seat?.seatId ?? null);
          if (me.seat?.displayName) setDisplayNameDraft(me.seat.displayName);
          setScreen("guest-confirm");
          return;
        } catch {
          setScreen("join");
        }
      }

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
    setView(null);
    setDecisionRationales({});
    setError(null);
    setScreen("local-setup");
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

  async function createRoom() {
    setBusy(true);
    setError(null);
    try {
      const invite = await enterHostModeAndCreateRoom();
      setRoom(invite);
      setLobbySeats(invite.seats ?? []);
      setMySeatId("1");
      setDisplayNameDraft(
        invite.seats?.find((s) => s.seatId === "1")?.displayName ?? "你",
      );
      setScreen("host-invite");
    } catch (err) {
      if (err instanceof Error && err.message === "redirecting") return;
      setError(err instanceof Error ? err.message : "创建房间失败");
    } finally {
      setBusy(false);
    }
  }

  async function selectLanHost(host: string) {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const next = await patchRoomHost(room.code, host);
      setRoom(next);
      if (next.seats) setLobbySeats(next.seats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换失败");
    } finally {
      setBusy(false);
    }
  }

  async function refreshLobby(origin: string, code: string) {
    try {
      const found = await fetchRoom(origin, code);
      setRoom(found);
      setLobbySeats(found.seats ?? []);
      const me = await fetchMySeat(origin, code);
      setMySeatId((prev) => me.seat?.seatId ?? prev);
      if (me.seat?.displayName) setDisplayNameDraft(me.seat.displayName);
      if (found.phase === "match" && !view) {
        const response = await fetch("/api/matches/current", {
          credentials: "include",
          cache: "no-store",
        });
        if (response.ok) {
          const body = (await response.json()) as {
            view: SeatView;
            matchId: string;
            decisionRationales?: Record<string, DecisionRationaleView>;
          };
          setView(body.view);
          setDecisionRationales(body.decisionRationales ?? {});
          setResumableMatchId(body.matchId);
        }
      }
    } catch {
      /* ignore poll errors */
    }
  }

  async function handleConfigure(seatId: string, config: HostSeatConfig) {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const result = await configureLobbySeat(room.code, seatId, config);
      setLobbySeats(result.seats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "配置座位失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartRoom() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const body = await startRoomMatch(room.code);
      setView(body.view);
      setDecisionRationales(
        (body.decisionRationales as Record<string, DecisionRationaleView>) ??
          {},
      );
      setResumableMatchId(body.matchId);
      setRoom({ ...room, phase: body.phase });
      await refreshMatchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法开局");
      void refreshCapabilities();
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim(seatId: string) {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const result = await claimSeat(
        guestOrigin,
        room.code,
        seatId,
        displayNameDraft.trim() || "客人",
      );
      setLobbySeats(result.seats);
      setMySeatId(result.seat.seatId);
      if (result.seat.displayName) setDisplayNameDraft(result.seat.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "占座失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(origin: string) {
    if (!room || !mySeatId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await renameSeat(
        origin,
        room.code,
        mySeatId,
        displayNameDraft.trim() || "客人",
      );
      setLobbySeats(result.seats);
      if (result.seat.displayName) setDisplayNameDraft(result.seat.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (
      !room ||
      (screen !== "host-invite" && screen !== "guest-confirm")
    ) {
      return;
    }
    const origin =
      screen === "guest-confirm" ? guestOrigin : window.location.origin;
    const id = window.setInterval(() => {
      void refreshLobby(origin, room.code);
    }, 1500);
    return () => window.clearInterval(id);
  }, [room, screen, guestOrigin, view]);

  useEffect(() => {
    if (screen === "host-invite" && !capabilities) {
      void refreshCapabilities();
    }
  }, [screen, capabilities]);

  // LAN match: poll view/presence and keep remote-seat heartbeat alive.
  useEffect(() => {
    if (!view || !room || room.phase !== "match") return;
    let cancelled = false;

    const refreshMatch = async () => {
      try {
        const response = await fetch("/api/matches/current", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as {
          view: SeatView;
          matchId: string;
          decisionRationales?: Record<string, DecisionRationaleView>;
          absences?: SeatAbsenceView[];
          pausedForAbsenceSeatId?: string | null;
        };
        if (cancelled) return;
        setView(body.view);
        setDecisionRationales(body.decisionRationales ?? {});
        setAbsences(body.absences ?? []);
        setPausedForAbsenceSeatId(body.pausedForAbsenceSeatId ?? null);
        setResumableMatchId(body.matchId);
      } catch {
        /* ignore */
      }
    };

    const beat = async () => {
      if (mySeatId === "1") return;
      try {
        const result = await postRoomHeartbeat(room.code);
        if (!cancelled) setAbsences(result.absences);
      } catch {
        /* guest may be mid-resume */
      }
    };

    void resumeRoomSeat(room.code)
      .then((result) => {
        if (!cancelled) setAbsences(result.absences);
      })
      .catch(() => {
        /* ignore */
      });

    void refreshMatch();
    void beat();
    const pollId = window.setInterval(() => void refreshMatch(), 1500);
    const beatId = window.setInterval(() => void beat(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(beatId);
    };
  }, [view?.matchId, room?.code, room?.phase, mySeatId]);

  async function handleAbsenceDisposition(
    seatId: string,
    action: DispositionAction,
  ) {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const body = await postSeatDisposition(room.code, seatId, action);
      if (body.aborted) {
        setView(null);
        setDecisionRationales({});
        setAbsences([]);
        setPausedForAbsenceSeatId(null);
        setResumableMatchId(null);
        setRoom(null);
        setScreen("home");
        await refreshMatchList();
        return;
      }
      if (body.view) {
        setView(body.view as SeatView);
      }
      if (body.decisionRationales) {
        setDecisionRationales(
          body.decisionRationales as Record<string, DecisionRationaleView>,
        );
      }
      if (Array.isArray(body.absences)) {
        setAbsences(body.absences as SeatAbsenceView[]);
      }
      if (Array.isArray(body.seats)) {
        setLobbySeats(body.seats as LobbySeat[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "处置失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleResumeSeat() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resumeRoomSeat(room.code);
      setAbsences(result.absences);
      const response = await fetch("/api/matches/current", {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const body = (await response.json()) as {
          view: SeatView;
          absences?: SeatAbsenceView[];
          pausedForAbsenceSeatId?: string | null;
          decisionRationales?: Record<string, DecisionRationaleView>;
        };
        setView(body.view);
        setAbsences(body.absences ?? result.absences);
        setPausedForAbsenceSeatId(body.pausedForAbsenceSeatId ?? null);
        setDecisionRationales(body.decisionRationales ?? {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "回席失败");
    } finally {
      setBusy(false);
    }
  }

  function openLocalSetup() {
    setScreen("local-setup");
    setError(null);
    void refreshCapabilities();
    void refreshMatchList();
  }

  if (view) {
    const lanMatch = Boolean(room && room.phase === "match");
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
          absences={absences}
          pausedForAbsenceSeatId={pausedForAbsenceSeatId}
          isHost={lanMatch && mySeatId === "1"}
          showResume={
            lanMatch &&
            mySeatId !== null &&
            mySeatId !== "1" &&
            absences.some(
              (a) =>
                a.seatId === mySeatId &&
                (a.phase === "reconnecting" ||
                  a.phase === "absent" ||
                  a.phase === "timed_out"),
            )
          }
          onAbsenceDisposition={
            lanMatch
              ? (seatId, action) =>
                  void handleAbsenceDisposition(seatId, action)
              : undefined
          }
          onResumeSeat={
            lanMatch ? () => void handleResumeSeat() : undefined
          }
        />
        {error ? <p className="desk-error">{error}</p> : null}
      </>
    );
  }

  if (screen === "home") {
    return (
      <main className="shell shell-home">
        <HomeEntry
          busy={busy}
          onLocal={openLocalSetup}
          onCreateRoom={() => void createRoom()}
          onJoinRoom={() => {
            setError(null);
            setScreen("join");
          }}
        />
        {error ? <p className="error home-error">{error}</p> : null}
      </main>
    );
  }

  if (screen === "host-invite" && room) {
    return (
      <main className="shell">
        <header className="top">
          <p className="eyebrow">局域网主机</p>
          <h1>政变</h1>
        </header>
        <HostInvitePanel
          room={room}
          seats={lobbySeats}
          mySeatId={mySeatId}
          busy={busy}
          probing={probing}
          capabilities={capabilities}
          displayNameDraft={displayNameDraft}
          onDisplayNameDraftChange={setDisplayNameDraft}
          onRename={() => void handleRename(window.location.origin)}
          onConfigure={(seatId, config) => void handleConfigure(seatId, config)}
          onProbe={() => void refreshCapabilities()}
          onStart={() => void handleStartRoom()}
          onBack={() => setScreen("home")}
          onSelectHost={(host) => void selectLanHost(host)}
          onCopy={() => {
            if (room.joinUrl) {
              void navigator.clipboard?.writeText(room.joinUrl);
            }
          }}
        />
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  if (screen === "join") {
    const params = new URLSearchParams(window.location.search);
    return (
      <main className="shell">
        <header className="top">
          <p className="eyebrow">加入房间</p>
          <h1>政变</h1>
        </header>
        <JoinRoomPage
          busy={busy}
          initialCode={params.get("code") ?? ""}
          initialLink={
            params.get("code")
              ? `${window.location.origin}/join?code=${params.get("code")}`
              : ""
          }
          onBack={() => setScreen("home")}
          onError={(message) => setError(message)}
          onJoined={(found, origin) => {
            setRoom(found);
            setLobbySeats(found.seats ?? []);
            setGuestOrigin(origin);
            setMySeatId(null);
            setError(null);
            setScreen("guest-confirm");
            void fetchMySeat(origin, found.code).then((me) => {
              setMySeatId(me.seat?.seatId ?? null);
              if (me.seat?.displayName) {
                setDisplayNameDraft(me.seat.displayName);
              }
            });
          }}
        />
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  if (screen === "guest-confirm" && room) {
    return (
      <main className="shell">
        <header className="top">
          <p className="eyebrow">加入方</p>
          <h1>政变</h1>
        </header>
        <GuestRoomConfirm
          room={room}
          origin={guestOrigin}
          seats={lobbySeats}
          mySeatId={mySeatId}
          busy={busy}
          displayNameDraft={displayNameDraft}
          onDisplayNameDraftChange={setDisplayNameDraft}
          onClaim={(seatId) => void handleClaim(seatId)}
          onRename={() => void handleRename(guestOrigin)}
          onBack={() => setScreen("join")}
        />
        {error ? <p className="error">{error}</p> : null}
      </main>
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
        <button
          type="button"
          className="ghost"
          onClick={() => setScreen("home")}
        >
          ← 返回入口
        </button>
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
