import { useEffect, useRef, useState } from "react";
import type { LegalDecision, SeatView } from "@coup/protocol";
import { MatchDesk, sfx, type AutoDecisionNotice, type TurnDeadline } from "@coup/web-desk";
import { HomeEntry } from "./HomeEntry";
import { HostInvitePanel } from "./HostInvitePanel";
import { JoinRoomPage } from "./JoinRoomPage";
import { GuestRoomConfirm } from "./GuestRoomConfirm";
import { AbsenceDrawer, absenceSeatStatus } from "./AbsenceDrawer";
import {
  abandonFailedRoomRecovery,
  claimSeat,
  configureLobbySeat,
  confirmRoomRematch,
  createRoomOnCurrentOrigin,
  declineRoomRematch,
  enterHostModeAndCreateRoom,
  enterRoomRematch,
  fetchMySeat,
  fetchRoom,
  leaveSeat,
  fetchRoomRecovery,
  loadPlayerName,
  matchCurrentPath,
  postRoomHeartbeat,
  postSeatDisposition,
  renameSeat,
  resumeRoomSeat,
  savePlayerName,
  startRoomMatch,
  updateRoomSettings,
  type DispositionAction,
  type LobbySeat,
  type RoomInvite,
  type SeatAbsenceView,
} from "./lanRoom";

type AgentPhase =
  | "idle"
  | "thinking"
  | "validating"
  | "retrying"
  | "failed";

type Screen = "home" | "host-invite" | "join" | "guest-confirm";

type MatchPollBody = {
  view?: SeatView;
  unchanged?: boolean;
  stateVersion?: number;
  absences?: SeatAbsenceView[];
  pausedForAbsenceSeatId?: string | null;
  turnDeadline?: TurnDeadline | null;
  autoDecision?: AutoDecisionNotice | null;
};

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
  const [displayNameDraft, setDisplayNameDraft] = useState(() => loadPlayerName() || "客人");
  const [view, setView] = useState<SeatView | null>(null);
  const [spectator, setSpectator] = useState(false);
  const [turnDeadline, setTurnDeadline] = useState<TurnDeadline | null>(null);
  const [autoDecision, setAutoDecision] = useState<AutoDecisionNotice | null>(null);
  const [decisionRationales] = useState<Record<string, never>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [absences, setAbsences] = useState<SeatAbsenceView[]>([]);
  const [pausedForAbsenceSeatId, setPausedForAbsenceSeatId] = useState<
    string | null
  >(null);
  const [turnTimeLimitSec, setTurnTimeLimitSec] = useState(60);
  const [lanRoomViewOnly, setLanRoomViewOnly] = useState(false);
  const [recoveryRooms, setRecoveryRooms] = useState<
    Array<{ code: string; status: "restored" | "failed"; reason: string | null }>
  >([]);

  // 错误提示 4 秒后自动消失
  useEffect(() => {
    if (!error) return;
    const id = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(id);
  }, [error]);

  // 浏览器标签页标题跟随状态
  useEffect(() => {
    document.title = view
      ? "政变 · 对局中"
      : room
        ? `政变 · 房间 ${room.code}`
        : "政变 Coup · 宫廷博弈";
  }, [view, room]);

  function applyPollBody(body: MatchPollBody) {
    if (body.view) {
      setView(body.view);
      setTurnDeadline(body.turnDeadline ?? null);
      if (body.autoDecision) setAutoDecision(body.autoDecision);
    }
    if (body.absences) setAbsences(body.absences);
    if (body.pausedForAbsenceSeatId !== undefined) {
      setPausedForAbsenceSeatId(body.pausedForAbsenceSeatId);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const recovery = await fetchRoomRecovery();
        const statuses = recovery.rooms.map(({ code, status, reason }) => ({ code, status, reason }));
        setRecoveryRooms(statuses);
        const recovered = recovery.rooms.find((item) => item.status === "restored");
        if (recovered) {
          const found = await fetchRoom(window.location.origin, recovered.code);
          setRoom(found);
          setLobbySeats(found.seats ?? recovered.seats);
          setTurnTimeLimitSec(found.turnTimeLimitSec ?? 60);
          const me = await fetchMySeat(
            window.location.origin,
            recovered.code,
          );
          setMySeatId(me.seat?.seatId ?? null);
          if (me.seat?.displayName) setDisplayNameDraft(me.seat.displayName);

          const enterMatchIfPossible = async () => {
            if (recovered.phase !== "match") return false;
            const response = await fetch(matchCurrentPath(recovered.code), {
              credentials: "include",
              cache: "no-store",
            });
            if (!response.ok) return false;
            const body = (await response.json()) as MatchPollBody;
            applyPollBody(body);
            return Boolean(body.view);
          };

          // Seat cookie distinguishes host vs guest on the same Origin.
          if (me.seat?.kind === "remote_human") {
            if (await enterMatchIfPossible()) return;
            setScreen("guest-confirm");
            return;
          }
          if (me.seat?.kind === "local_human" && me.seat.seatId === "1") {
            if (await enterMatchIfPossible()) return;
            setScreen("host-invite");
            return;
          }
          // Restored room but no seat cookie: host must abandon or guest joins by code.
          const joinParams = new URLSearchParams(window.location.search);
          const joinCode = joinParams.get("code");
          if (
            !(
              (window.location.pathname === "/join" || joinCode) &&
              joinCode &&
              /^\d{4}$/.test(joinCode)
            )
          ) {
            setError("已恢复房间，但本机没有座位凭证。请选择房间号加入，或逐房放弃。");
            setScreen("home");
            return;
          }
        }
      } catch {
        /* recovery probe is best-effort before other entry paths */
      }

      const createRoomParams = new URLSearchParams(window.location.search);
      if (createRoomParams.get("createRoom") === "1") {
        createRoomParams.delete("createRoom");
        const nextQuery = createRoomParams.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`,
        );
        setBusy(true);
        try {
          const invite = await createRoomOnCurrentOrigin();
          setRoom(invite);
          setLobbySeats(invite.seats ?? []);
          setTurnTimeLimitSec(invite.turnTimeLimitSec ?? 60);
          setMySeatId("1");
          setDisplayNameDraft(
            invite.seats?.find((s) => s.seatId === "1")?.displayName ?? "你",
          );
          setScreen("host-invite");
        } catch (err) {
          const message = err instanceof Error ? err.message : "创建房间失败";
          setError(message);
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
          setTurnTimeLimitSec(found.turnTimeLimitSec ?? 60);
          const me = await fetchMySeat(window.location.origin, code);
          setMySeatId(me.seat?.seatId ?? null);
          if (me.seat?.displayName) setDisplayNameDraft(me.seat.displayName);
          if (found.phase === "match") {
            const response = await fetch(matchCurrentPath(code), {
              credentials: "include",
              cache: "no-store",
            });
            if (response.ok) {
              const body = (await response.json()) as MatchPollBody;
              applyPollBody(body);
              if (body.view) return;
            }
          }
          setScreen("guest-confirm");
          return;
        } catch (err) {
          setError(err instanceof Error ? err.message : "无法查询房间");
          setScreen("join");
        }
      }
    })();
  }, []);

  async function createRoom() {
    setBusy(true);
    setError(null);
    try {
      const invite = await enterHostModeAndCreateRoom();
      setRoom(invite);
      setLobbySeats(invite.seats ?? []);
      setTurnTimeLimitSec(invite.turnTimeLimitSec ?? 60);
      setMySeatId("1");
      setDisplayNameDraft(
        invite.seats?.find((s) => s.seatId === "1")?.displayName ?? "你",
      );
      setScreen("host-invite");
    } catch (err) {
      const message = err instanceof Error ? err.message : "创建房间失败";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function abandonRecovery(roomCode: string) {
    setBusy(true);
    setError(null);
    try {
      await abandonFailedRoomRecovery(roomCode);
      setRecoveryRooms((rooms) => rooms.filter((room) => room.code !== roomCode));
      await createRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : "放弃旧房间失败");
      setBusy(false);
    }
  }

  function returnToLanRoom() {
    setView(null);
    setTurnDeadline(null);
    setSpectator(false);
    setAbsences([]);
    setPausedForAbsenceSeatId(null);
    setError(null);
    setLanRoomViewOnly(true);
    setScreen(mySeatId === "1" ? "host-invite" : "guest-confirm");
  }

  async function resumeLanMatch() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(matchCurrentPath(room.code), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("当前对局不可用");
      }
      const body = (await response.json()) as MatchPollBody;
      if (!body.view) throw new Error("当前对局不可用");
      applyPollBody(body);
      setSpectator(false);
      setLanRoomViewOnly(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法返回对局");
    } finally {
      setBusy(false);
    }
  }

  async function enterSpectate() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(matchCurrentPath(room.code, false, { spectate: true }), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("观战不可用");
      }
      const body = (await response.json()) as MatchPollBody;
      if (!body.view) throw new Error("观战不可用");
      applyPollBody(body);
      setSpectator(true);
      setLanRoomViewOnly(false);
      setScreen("guest-confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法观战");
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(decision: LegalDecision, label: string) {
    if (!view || !room) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(matchCurrentPath(room.code, true), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 1,
          requestId: `req-${view.stateVersion}-${label}-${Date.now()}`,
          stateVersion: view.stateVersion,
          decision,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (body?.error === "seat_absent") {
          setError("你当前处于离席状态，请先回席。");
          throw new Error("seat_absent");
        }
        throw new Error(body?.error ?? "提交失败");
      }
      const body = (await response.json()) as MatchPollBody;
      applyPollBody(body);
    } catch (err) {
      if ((err as Error).message !== "seat_absent") {
        setError(err instanceof Error ? err.message : "提交失败");
        sfx.play("error");
      }
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
      setRoom({ ...room, phase: body.phase });
      setSpectator(false);
      setLanRoomViewOnly(false);
      sfx.play("deal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法开局");
    } finally {
      setBusy(false);
    }
  }

  async function handleTurnTimeLimitChange(seconds: number) {
    if (!room) return;
    const previous = turnTimeLimitSec;
    setTurnTimeLimitSec(seconds);
    try {
      await updateRoomSettings(room.code, { turnTimeLimitSec: seconds });
    } catch (err) {
      setTurnTimeLimitSec(previous);
      setError(err instanceof Error ? err.message : "保存设置失败");
    }
  }

  async function handleRematch() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const next = await enterRoomRematch(room.code);
      setRoom({
        ...room,
        phase: next.phase,
        seats: next.seats,
      });
      setLobbySeats(next.seats);
      setView(null);
      setTurnDeadline(null);
      setSpectator(false);
      setScreen("host-invite");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法进入续局等待");
    } finally {
      setBusy(false);
    }
  }

  async function handleRematchJoin() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmRoomRematch(room.code);
      setLobbySeats(result.seats);
      setMySeatId(result.seat.seatId);
      sfx.play("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入对局失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRematchLeave() {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      await declineRoomRematch(room.code);
      setView(null);
      setRoom(null);
      setLobbySeats([]);
      setMySeatId(null);
      setAbsences([]);
      setSpectator(false);
      setScreen("home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "离开对局失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim(seatId: string) {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const name = displayNameDraft.trim() || loadPlayerName() || "客人";
      const result = await claimSeat(
        window.location.origin,
        room.code,
        seatId,
        name,
      );
      savePlayerName(name);
      setLobbySeats(result.seats);
      setMySeatId(result.seat.seatId);
      if (result.seat.displayName) setDisplayNameDraft(result.seat.displayName);
      sfx.play("join");
    } catch (err) {
      setError(err instanceof Error ? err.message : "占座失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename() {
    if (!room || !mySeatId) return;
    setBusy(true);
    setError(null);
    try {
      const name = displayNameDraft.trim() || "客人";
      const result = await renameSeat(
        window.location.origin,
        room.code,
        mySeatId,
        name,
      );
      savePlayerName(name);
      setLobbySeats(result.seats);
      if (result.seat.displayName) setDisplayNameDraft(result.seat.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfigure(
    seatId: string,
    config: { kind: "open" } | { kind: "closed" },
  ) {
    if (!room) return;
    // 乐观更新：预设会连发多次，等每个响应回来即可
    try {
      const result = await configureLobbySeat(room.code, seatId, config);
      setLobbySeats(result.seats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "配置座位失败");
    }
  }

  async function handleLeaveSeat() {
    if (!room) return;
    setBusy(true);
    try {
      await leaveSeat(window.location.origin, room.code);
      setRoom(null);
      setMySeatId(null);
      setLobbySeats([]);
      setView(null);
      setScreen("home");
      setError("已让出座位，可以随时重新入座");
    } catch (err) {
      setError(err instanceof Error ? err.message : "让座失败");
    } finally {
      setBusy(false);
    }
  }

  async function refreshLobby(origin: string, code: string) {
    try {
      const found = await fetchRoom(origin, code);
      setRoom(found);
      setLobbySeats(found.seats ?? []);
      setTurnTimeLimitSec((prev) => found.turnTimeLimitSec ?? prev);
      const me = await fetchMySeat(origin, code);
      setMySeatId((prev) => me.seat?.seatId ?? prev);
      if (found.phase === "match" && !view && !lanRoomViewOnly) {
        const response = await fetch(matchCurrentPath(code), {
          credentials: "include",
          cache: "no-store",
        });
        if (response.ok) {
          const body = (await response.json()) as MatchPollBody;
          if (body.view) {
            applyPollBody(body);
          }
        }
      }
    } catch (err) {
      // 404 → 房间已被清扫/解散：明确告知并退回首页，避免停在死房间页。
      if ((err as { status?: number }).status === 404) {
        setRoom(null);
        setView(null);
        setScreen("home");
        setError("房间已解散或已被回收");
      }
    }
  }

  useEffect(() => {
    if (!room || (screen !== "host-invite" && screen !== "guest-confirm")) {
      return;
    }
    const origin = window.location.origin;
    const id = window.setInterval(() => {
      void refreshLobby(origin, room.code);
    }, 1500);
    return () => window.clearInterval(id);
  }, [room, screen, view, lanRoomViewOnly]);

  // 终局后客人停在结果画面，轮询房间以发现主机开启的续局等待。
  useEffect(() => {
    if (
      !view ||
      !room ||
      view.publicState.status !== "finished" ||
      mySeatId === "1"
    ) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const found = await fetchRoom(window.location.origin, room.code);
        if (cancelled) return;
        setRoom(found);
        setLobbySeats(found.seats ?? []);
      } catch (err) {
        if ((err as { status?: number }).status === 404) {
          setRoom(null);
          setView(null);
          setScreen("home");
          setError("房间已解散或已被回收");
          return;
        }
        /* keep waiting */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [view?.publicState?.status, view?.matchId, room?.code, mySeatId]);

  // LAN match: incremental poll (since=stateVersion) + presence heartbeat.
  useEffect(() => {
    if (!view || !room || room.phase !== "match") return;
    let cancelled = false;

    const refreshMatch = async () => {
      try {
        const since = view.stateVersion;
        const response = await fetch(
          matchCurrentPath(room.code, false, { since }),
          {
            credentials: "include",
            cache: "no-store",
          },
        );
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as MatchPollBody;
        if (cancelled) return;
        if (body.unchanged) {
          // 状态未变：只刷新在线/暂停信息，不重建视图（ADR-0008）
          if (body.absences) setAbsences(body.absences);
          if (body.pausedForAbsenceSeatId !== undefined) {
            setPausedForAbsenceSeatId(body.pausedForAbsenceSeatId);
          }
          if (body.turnDeadline !== undefined) {
            setTurnDeadline(body.turnDeadline);
          }
          return;
        }
        applyPollBody(body);
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

    if (mySeatId !== "1") {
      void resumeRoomSeat(room.code)
        .then((result) => {
          if (!cancelled) setAbsences(result.absences);
        })
        .catch(() => {
          /* ignore */
        });
    }

    void refreshMatch();
    void beat();
    const pollId = window.setInterval(() => void refreshMatch(), 1500);
    const beatId = window.setInterval(() => void beat(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(beatId);
    };
  }, [view?.matchId, room?.code, room?.phase, mySeatId, view?.stateVersion]);

  // A remote human who has returned to the room view still needs a lease
  // heartbeat while the match continues in the authority.
  useEffect(() => {
    if (
      !lanRoomViewOnly ||
      view ||
      !room ||
      room.phase !== "match" ||
      mySeatId === null ||
      mySeatId === "1"
    ) {
      return;
    }
    let cancelled = false;
    const beat = async () => {
      try {
        const result = await postRoomHeartbeat(room.code);
        if (!cancelled) setAbsences(result.absences);
      } catch {
        /* the room view can continue while the host is briefly unreachable */
      }
    };
    void beat();
    const id = window.setInterval(() => void beat(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [lanRoomViewOnly, view, room?.code, room?.phase, mySeatId]);

  // Spectator poll: keep the read-only desk in sync.
  useEffect(() => {
    if (!spectator || !view || !room || room.phase !== "match") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(
          matchCurrentPath(room.code, false, { spectate: true }),
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as MatchPollBody;
        if (!cancelled && body.view) applyPollBody(body);
      } catch {
        /* ignore */
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [spectator, view?.matchId, room?.code, room?.phase]);

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
        setAbsences([]);
        setPausedForAbsenceSeatId(null);
        setTurnDeadline(null);
        setRoom(null);
        setScreen("home");
        return;
      }
      if (body.view) {
        setView(body.view as SeatView);
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
      const response = await fetch(matchCurrentPath(room.code), {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const body = (await response.json()) as MatchPollBody;
        applyPollBody(body);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "回席失败");
    } finally {
      setBusy(false);
    }
  }

  function myRematchStatus(): "awaiting" | "confirmed" | "left" | null {
    if (!room || room.phase !== "rematch" || !mySeatId) return null;
    return (
      lobbySeats.find((s) => s.seatId === mySeatId)?.rematchStatus ?? null
    );
  }

  function rematchPrompt() {
    const status = myRematchStatus();
    if (!status) return null;
    if (status === "confirmed") {
      return (
        <div className="rematch-prompt" role="status">
          <strong>已确认加入</strong>
          <p>等待主机开始新对局…</p>
        </div>
      );
    }
    if (status === "left") return null;
    return (
      <div className="rematch-prompt" role="dialog" aria-label="续局确认">
        <strong>上一局已结束</strong>
        <p>主机开启了续局等待。你要加入新对局吗？</p>
        <div className="rematch-actions">
          <button
            type="button"
            className="response-button primary"
            disabled={busy}
            onClick={() => void handleRematchJoin()}
          >
            加入对局
          </button>
          <button
            type="button"
            className="response-button"
            disabled={busy}
            onClick={() => void handleRematchLeave()}
          >
            离开对局
          </button>
        </div>
      </div>
    );
  }

  if (view) {
    const lanMatch = Boolean(room && room.phase === "match");
    return (
      <>
        <MatchDesk
          view={view}
          busy={busy}
          agentPhase="idle"
          decisionRationales={decisionRationales}
          onSubmitDecision={(decision, label) =>
            void submitDecision(decision, label)
          }
          returnLabel={lanMatch ? "返回房间" : "返回开局"}
          onReturnToSetup={returnToLanRoom}
          onRematch={
            lanMatch && mySeatId === "1" ? () => void handleRematch() : undefined
          }
          seatStatusFor={(seatId) => absenceSeatStatus(absences, seatId)}
          roomCode={room?.code ?? null}
          turnDeadline={turnDeadline}
          autoDecision={autoDecision}
          spectator={spectator}
          absenceSlot={
            spectator ? null : (
              <AbsenceDrawer
                absences={absences}
                seatNames={Object.fromEntries(
                  view.publicState.seats.map((seat) => [
                    seat.seatId,
                    seat.displayName,
                  ]),
                )}
                isHost={lanMatch && mySeatId === "1"}
                busy={busy}
                pausedForAbsenceSeatId={pausedForAbsenceSeatId}
                onDisposition={(seatId, action) =>
                  void handleAbsenceDisposition(seatId, action)
                }
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
                onResume={() => void handleResumeSeat()}
              />
            )
          }
        />
        {error ? <p className="desk-error">{error}</p> : null}
        {view.publicState.status === "finished" ? rematchPrompt() : null}
      </>
    );
  }

  if (screen === "home") {
    return (
      <main className="shell shell-home">
        <HomeEntry
          busy={busy}
          recoveryRooms={recoveryRooms}
          onAbandonRecovery={(code) => void abandonRecovery(code)}
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
      <main className="lobby-shell">
        <HostInvitePanel
          room={room}
          seats={lobbySeats}
          mySeatId={mySeatId}
          busy={busy}
          displayNameDraft={displayNameDraft}
          onDisplayNameDraftChange={setDisplayNameDraft}
          onRename={() => void handleRename()}
          onConfigure={(seatId, config) => void handleConfigure(seatId, config)}
          onStart={() => void handleStartRoom()}
          onResumeMatch={() => void resumeLanMatch()}
          onBack={() => setScreen("home")}
          turnTimeLimitSec={turnTimeLimitSec}
          onTurnTimeLimitChange={(seconds) =>
            void handleTurnTimeLimitChange(seconds)
          }
        />
        {error ? <p className="error home-error">{error}</p> : null}
      </main>
    );
  }

  if (screen === "join") {
    const params = new URLSearchParams(window.location.search);
    return (
      <main className="page-console">
        <JoinRoomPage
          busy={busy}
          initialCode={params.get("code") ?? ""}
          onBack={() => setScreen("home")}
          onError={(message) => setError(message)}
          onJoined={(found, origin) => {
            setRoom(found);
            setLobbySeats(found.seats ?? []);
            setTurnTimeLimitSec(found.turnTimeLimitSec ?? 60);
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
        {error ? <p className="error home-error">{error}</p> : null}
      </main>
    );
  }

  if (screen === "guest-confirm" && room) {
    return (
      <main className="lobby-shell">
        <GuestRoomConfirm
          room={room}
          seats={lobbySeats}
          mySeatId={mySeatId}
          busy={busy}
          displayNameDraft={displayNameDraft}
          onDisplayNameDraftChange={setDisplayNameDraft}
          onClaim={(seatId) => void handleClaim(seatId)}
          onRename={() => void handleRename()}
          onLeaveSeat={() => void handleLeaveSeat()}
          onResumeMatch={() => void resumeLanMatch()}
          onSpectate={() => void enterSpectate()}
          onBack={() => setScreen("join")}
        />
        {rematchPrompt()}
        {error ? <p className="error home-error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="shell shell-home">
      <HomeEntry
        busy={busy}
        recoveryRooms={recoveryRooms}
        onAbandonRecovery={(code) => void abandonRecovery(code)}
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
