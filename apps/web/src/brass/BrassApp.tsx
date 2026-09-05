import { useCallback, useEffect, useRef, useState } from "react";
import {
  abandonBrassRecovery,
  claimBrassSeat,
  configureBrassSeat,
  confirmBrassRematch,
  createBrassRoom,
  declineBrassRematch,
  enterBrassRematch,
  fetchBrassMatch,
  fetchBrassPresence,
  fetchBrassRecovery,
  fetchBrassRoom,
  fetchMyBrassSeat,
  leaveBrassSeat,
  brassMatchUrl,
  postBrassDisposition,
  postBrassHeartbeat,
  renameBrassSeat,
  resumeBrassSeat,
  startBrassMatchOn,
  updateBrassSettings,
  type BrassLobbySeat,
  type BrassMatchPollBody,
  type BrassRoomInvite,
  type BrassSeatAbsence,
  type BrassView,
} from "./brassApi.js";
import { errorText } from "./labels.js";
import { BrassTable } from "./table/BrassTable.js";
import { GameHomeScreen, GameRoomScreen } from "../platform/RoomUi.js";
import { loadPlayerName, savePlayerName } from "../lanRoom.js";

type Screen = "home" | "room" | "play";


function initialScreen(): { screen: Screen; code: string | null } {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  // 深链：/brass/room/:code、/brass/play/:code（刷新后恢复房间）。
  const pathMatch = path.match(/^\/brass\/(?:room|play)\/(\d{4})/);
  if (pathMatch) return { screen: "home", code: pathMatch[1] };
  if (path === "/brass/join" || (path === "/brass" && code)) {
    return { screen: "home", code };
  }
  return { screen: "home", code: null };
}

export function BrassApp() {
  const initial = useRef(initialScreen());
  const [screen, setScreen] = useState<Screen>("home");
  const [room, setRoom] = useState<BrassRoomInvite | null>(null);
  const [mySeatId, setMySeatId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => loadPlayerName() || "客人");
  const [view, setView] = useState<BrassView | null>(null);
  const [absences, setAbsences] = useState<BrassSeatAbsence[]>([]);
  const [turnDeadline, setTurnDeadline] = useState<BrassMatchPollBody["turnDeadline"]>(null);
  const [autoDecision, setAutoDecision] = useState<BrassMatchPollBody["autoDecision"]>(null);
  const [pausedSeatId, setPausedSeatId] = useState<string | null>(null);
  const [spectator, setSpectator] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryItems, setRecoveryItems] = useState<Array<{ code: string; status: string; reason: string | null }>>([]);
  const [joinCode, setJoinCode] = useState(initial.current.code ?? "");
  const [busy, setBusy] = useState(false);

  const showToast = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError((cur) => (cur === message ? null : cur)), 4000);
  }, []);

  // 浏览器标签页标题跟随状态（与 coup App.tsx 同款模式）。
  useEffect(() => {
    document.title = room
      ? `工业革命 · 伯明翰 · 房间 ${room.code}`
      : "工业革命 · 伯明翰";
  }, [room]);

  useEffect(() => {
    fetchBrassRecovery()
      .then((body) => setRecoveryItems(body.items.filter((i) => i.status === "failed")))
      .catch(() => undefined);
  }, []);

  const enterRoom = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const invite = await fetchBrassRoom(code);
        setRoom(invite);
        const me = await fetchMyBrassSeat(code).catch(() => null);
        setMySeatId(me?.seat?.seatId ?? null);
        // 之前以观战身份进过对局的访客，回席后必须切回玩家轮询（否则看不到手牌）。
        setSpectator(!me?.seat);
        setScreen("room");
        window.history.replaceState(null, "", `/brass/room/${code}`);
      } catch (e) {
        showToast(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  // 深链 /brass/join?code=####
  useEffect(() => {
    const code = initial.current.code;
    if (code && /^\d{4}$/.test(code)) {
      void enterRoom(code);
    }
  }, [enterRoom]);

  // 大厅轮询。
  useEffect(() => {
    if (screen !== "room" || !room) return;
    const code = room.code;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const invite = await fetchBrassRoom(code);
        if (!alive) return;
        setRoom(invite);
        if (invite.phase === "match") {
          setScreen("play");
        }
      } catch (e) {
        // 404 → 房间已被清扫/解散：明确告知并退回首页，避免停在死房间页。
        if (!alive) return;
        if ((e as { status?: number }).status === 404) {
          setRoom(null);
          setScreen("home");
          showToast("房间已解散或已被回收");
          window.history.replaceState(null, "", "/brass");
        }
      }
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [screen, room?.code, showToast]);

  // 对局轮询（增量）。
  useEffect(() => {
    if (screen !== "play" || !room) return;
    const code = room.code;
    let alive = true;
    let lastVersion: number | null = null;
    let stopped = false;
    const poll = async () => {
      try {
        const query = spectator ? { spectate: true } : lastVersion != null ? { since: lastVersion } : undefined;
        const body = await fetchBrassMatch(code, query);
        if (!alive) return;
        if (body.view) {
          setView(body.view);
          lastVersion = body.view.stateVersion;
        } else if (body.unchanged && body.absences) {
          // 轻量载荷。
        }
        setAbsences(body.absences ?? []);
        setPausedSeatId(body.pausedForAbsenceSeatId ?? null);
        setTurnDeadline(body.turnDeadline ?? null);
        setAutoDecision(body.autoDecision ?? null);
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 404) {
          setScreen("room");
          setView(null);
        }
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 1500);
    return () => {
      alive = false;
      stopped = true;
      clearInterval(timer);
    };
  }, [screen, room?.code, spectator, view?.state.status]);

  // 回席 + 心跳。
  useEffect(() => {
    if (screen !== "play" || !room || spectator) return;
    const code = room.code;
    void resumeBrassSeat(code).catch(() => undefined);
    const timer = setInterval(() => {
      void postBrassHeartbeat(code).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [screen, room?.code, spectator]);

  // 观战心跳（无凭证）。
  useEffect(() => {
    if (screen !== "play" || !spectator || !room) return;
    const timer = setInterval(() => {
      void fetchBrassPresence(room.code).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [screen, spectator, room?.code]);

  async function handleCreate(): Promise<void> {
    setBusy(true);
    try {
      const invite = await createBrassRoom();
      setRoom(invite);
      setMySeatId("1");
      setSpectator(false);
      setScreen("room");
      window.history.replaceState(null, "", `/brass/room/${invite.code}`);
    } catch (e) {
      showToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(): Promise<void> {
    if (!/^\d{4}$/.test(joinCode)) {
      showToast("请输入 4 位房间号");
      return;
    }
    await enterRoom(joinCode);
  }

  if (screen === "play" && room) {
    return (
      <div className="brass-app">
        {view ? (
          <BrassTable
            view={view}
            roomCode={room.code}
            absences={absences}
            turnDeadline={turnDeadline ?? null}
            autoDecision={autoDecision ?? null}
            onError={showToast}
          />
        ) : (
          <div className="brass-loading">正在载入对局…</div>
        )}
        {pausedSeatId ? <AbsenceOverlay code={room.code} seatId={pausedSeatId} isHost={mySeatId === "1"} absences={absences} onDismiss={() => setPausedSeatId(null)} onError={showToast} /> : null}
        {view?.state.status === "finished" ? (
          <RematchBar
            code={room.code}
            phase={room.phase}
            mySeatId={mySeatId}
            seats={room.seats ?? []}
            onRematch={async () => {
              try {
                await enterBrassRematch(room.code);
                const invite = await fetchBrassRoom(room.code);
                setRoom(invite);
                setScreen("room");
              } catch (e) {
                showToast(errorText(e));
              }
            }}
            onConfirm={async () => {
              try {
                await confirmBrassRematch(room.code);
                showToast("已确认续局");
              } catch (e) {
                showToast(errorText(e));
              }
            }}
            onSpectate={() => setSpectator(true)}
          />
        ) : null}
        {error ? <div className="brass-toast">{error}</div> : null}
      </div>
    );
  }

  if (screen === "room" && room) {
    const isHost = mySeatId === "1";
    return (
      <>
        <GameRoomScreen
          game="brass"
          homeHref="/brass"
          title="工业革命 · 伯明翰"
          code={room.code}
          seats={room.seats ?? []}
          phase={room.phase}
          isHost={isHost}
          mySeatId={mySeatId}
          busy={busy}
          displayName={displayName}
          onDisplayNameChange={(name) => {
            setDisplayName(name);
            savePlayerName(name);
          }}
          onRename={async () => {
            if (!mySeatId) return;
            try {
              await renameBrassSeat(room.code, mySeatId, displayName);
            } catch {
              /* 改名失败不打扰 */
            }
          }}
          onClaim={async (seatId) => {
            try {
              const result = await claimBrassSeat(room.code, seatId, displayName);
              setMySeatId(result.seat.seatId);
              setSpectator(false);
              const invite = await fetchBrassRoom(room.code);
              setRoom(invite);
              showToast(`已就座 ${seatId} 号`);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          onConfigure={async (seatId, kind) => {
            try {
              await configureBrassSeat(room.code, seatId, kind);
              const invite = await fetchBrassRoom(room.code);
              setRoom(invite);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          onLeaveSeat={async () => {
            try {
              await leaveBrassSeat(room.code);
              setRoom(null);
              setMySeatId(null);
              setScreen("home");
              window.history.replaceState(null, "", "/brass");
              showToast("已让出座位，可以随时重新入座");
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          onStart={async () => {
            try {
              await startBrassMatchOn(room.code);
              setScreen("play");
              setSpectator(false);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          startLabel="开始对局"
          turnTimeLimitSec={room.turnTimeLimitSec ?? 60}
          onTurnTimeLimitChange={async (sec) => {
            try {
              await updateBrassSettings(room.code, sec);
              const invite = await fetchBrassRoom(room.code);
              setRoom(invite);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          hostHint="运河时代第 1 回合每人 1 个行动，之后每回合 2 个行动。"
          waitingNote="保持本页打开，掉线 15 秒内回到本页可自动回席。"
        />
        {error ? <div className="brass-toast">{error}</div> : null}
      </>
    );
  }

  // 大厅首页
  return (
    <>
      <GameHomeScreen
        game="brass"
        backHref="/"
        title="工业革命 · 伯明翰"
        subtitle="2–4 人 · 运河与铁路两个时代 · 每回合 2 个行动"
        createCta="创建新房间"
        onCreate={() => void handleCreate()}
        busy={busy}
        joinCode={joinCode}
        onJoinCodeChange={setJoinCode}
        onJoin={() => void handleJoin()}
        displayName={displayName}
        onDisplayNameChange={(name) => {
          setDisplayName(name);
          savePlayerName(name);
        }}
        recoveryItems={recoveryItems.map((item) => ({ code: item.code, reason: item.reason }))}
        onAbandonRecovery={(code) => {
          void (async () => {
            try {
              await abandonBrassRecovery(code);
              setRecoveryItems((items) => items.filter((i) => i.code !== code));
            } catch (e) {
              showToast(errorText(e));
            }
          })();
        }}
      />
      {error ? <div className="brass-toast">{error}</div> : null}
    </>
  );
}

function AbsenceOverlay({
  code,
  seatId,
  isHost,
  absences,
  onDismiss,
  onError,
}: {
  code: string;
  seatId: string;
  isHost: boolean;
  absences: BrassSeatAbsence[];
  onDismiss: () => void;
  onError: (m: string) => void;
}) {
  const absence = absences.find((a) => a.seatId === seatId);
  return (
    <div className="brass-overlay" role="dialog">
      <div className="brass-overlay-card">
        <h3>{seatId} 号玩家离席</h3>
        <p className="brass-hint">状态：{absence?.phase === "reconnecting" ? "重连中" : "离席"}。离席超过 5 分钟后房主可选择终止对局。</p>
        {isHost ? (
          <div className="brass-settings-row">
            <button
              type="button"
              className="brass-ghost-btn"
              onClick={async () => {
                try {
                  await postBrassDisposition(code, seatId, "extend_wait");
                  onDismiss();
                } catch (e) {
                  onError(errorText(e));
                }
              }}
            >
              继续等待
            </button>
            <button
              type="button"
              className="brass-danger-btn"
              onClick={async () => {
                try {
                  await postBrassDisposition(code, seatId, "technical_abort");
                  onDismiss();
                  window.location.reload();
                } catch (e) {
                  onError(errorText(e));
                }
              }}
            >
              终止对局
            </button>
          </div>
        ) : (
          <button type="button" className="brass-ghost-btn" onClick={onDismiss}>
            知道了
          </button>
        )}
      </div>
    </div>
  );
}

function RematchBar({
  code,
  phase,
  mySeatId,
  seats,
  onRematch,
  onConfirm,
  onSpectate,
}: {
  code: string;
  phase: string;
  mySeatId: string | null;
  seats: BrassLobbySeat[];
  onRematch: () => void;
  onConfirm: () => void;
  onSpectate: () => void;
}) {
  const confirmed = seats.filter((s) => s.rematchStatus === "confirmed").length;
  const awaitingMe = seats.some((s) => s.seatId === mySeatId && s.rematchStatus === "awaiting");
  if (phase !== "rematch") {
    return (
      <div className="brass-rematch-bar">
        <button type="button" className="brass-ghost-btn" onClick={onSpectate}>
          保持观战
        </button>
        <button type="button" className="brass-ghost-btn" onClick={() => window.location.assign("/brass")}>
          返回大厅
        </button>
      </div>
    );
  }
  return (
    <div className="brass-rematch-bar">
      <span>续局等待：{confirmed}/{seats.filter((s) => s.kind !== "closed" && s.kind !== "open").length} 已确认</span>
      {awaitingMe ? (
        <button type="button" className="brass-primary-btn" onClick={onConfirm}>
          确认再来一局
        </button>
      ) : null}
      {mySeatId === "1" ? (
        <button type="button" className="brass-ghost-btn" onClick={onRematch}>
          重置为续局等待
        </button>
      ) : null}
      <button type="button" className="brass-ghost-btn" onClick={() => window.location.assign(`/brass/room/${code}`)}>
        返回房间
      </button>
    </div>
  );
}

export { brassMatchUrl, declineBrassRematch, fetchBrassMatch };
