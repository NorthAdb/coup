import { useCallback, useEffect, useRef, useState } from "react";
import {
  abandonSplendorRecovery,
  claimSplendorSeat,
  configureSplendorSeat,
  confirmSplendorRematch,
  createSplendorRoom,
  enterSplendorRematch,
  fetchMySplendorSeat,
  leaveSplendorSeat,
  fetchSplendorMatch,
  fetchSplendorPresence,
  fetchSplendorRecovery,
  fetchSplendorRoom,
  postSplendorDisposition,
  postSplendorHeartbeat,
  renameSplendorSeat,
  resumeSplendorSeat,
  startSplendorMatchOn,
  updateSplendorSettings,
  type SplendorLobbySeat,
  type SplendorMatchPollBody,
  type SplendorRoomInvite,
  type SplendorSeatAbsence,
  type SplendorView,
} from "./splendorApi.js";
import { errorText } from "./labels.js";
import { SplendorTable } from "./table/SplendorTable.js";
import { GameHomeScreen, GameRoomScreen } from "../platform/RoomUi.js";
import { loadPlayerName, savePlayerName } from "../lanRoom.js";

type Screen = "home" | "room" | "play";


function initialScreen(): { code: string | null } {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  // 深链：/splendor/room/:code、/splendor/join?code=####（刷新后恢复房间）。
  const pathMatch = path.match(/^\/splendor\/(?:room|play)\/(\d{4})/);
  if (pathMatch) return { code: pathMatch[1] };
  if (path === "/splendor/join" || (path === "/splendor" && code)) return { code };
  return { code: null };
}

export function SplendorApp() {
  const initial = useRef(initialScreen());
  const [screen, setScreen] = useState<Screen>("home");
  const [room, setRoom] = useState<SplendorRoomInvite | null>(null);
  const [mySeatId, setMySeatId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => loadPlayerName() || "客人");
  const [view, setView] = useState<SplendorView | null>(null);
  const [absences, setAbsences] = useState<SplendorSeatAbsence[]>([]);
  const [turnDeadline, setTurnDeadline] = useState<SplendorMatchPollBody["turnDeadline"]>(null);
  const [autoDecision, setAutoDecision] = useState<SplendorMatchPollBody["autoDecision"]>(null);
  const [pausedSeatId, setPausedSeatId] = useState<string | null>(null);
  const [spectator, setSpectator] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryItems, setRecoveryItems] = useState<Array<{ code: string; status: string; reason: string | null }>>([]);
  const [joinCode, setJoinCode] = useState(initial.current.code ?? "");
  const [busy, setBusy] = useState(false);

  // 提交后立即触发一次轮询，让行动即时生效（不等下一个轮询周期）。
  const pollNowRef = useRef<(() => void) | null>(null);

  const showToast = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError((cur) => (cur === message ? null : cur)), 4000);
  }, []);

  // 浏览器标签页标题跟随状态。
  useEffect(() => {
    document.title = room
      ? `璀璨宝石 · 房间 ${room.code}`
      : "璀璨宝石";
  }, [room]);

  useEffect(() => {
    fetchSplendorRecovery()
      .then((body) => setRecoveryItems(body.items.filter((i) => i.status === "failed")))
      .catch(() => undefined);
  }, []);

  const enterRoom = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const invite = await fetchSplendorRoom(code);
        setRoom(invite);
        const me = await fetchMySplendorSeat(code).catch(() => null);
        setMySeatId(me?.seat?.seatId ?? null);
        // 之前以观战身份进过对局的访客，回席后必须切回玩家轮询。
        setSpectator(!me?.seat);
        setScreen("room");
        window.history.replaceState(null, "", `/splendor/room/${code}`);
      } catch (e) {
        showToast(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [showToast],
  );

  // 深链 /splendor/join?code=####
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
        const invite = await fetchSplendorRoom(code);
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
          window.history.replaceState(null, "", "/splendor");
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
        const body = await fetchSplendorMatch(code, query);
        if (!alive) return;
        if (body.view) {
          setView(body.view);
          lastVersion = body.view.stateVersion;
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
    pollNowRef.current = () => void poll();
    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 1500);
    return () => {
      alive = false;
      stopped = true;
      pollNowRef.current = null;
      clearInterval(timer);
    };
  }, [screen, room?.code, spectator, view?.state.status]);

  // 回席 + 心跳。
  useEffect(() => {
    if (screen !== "play" || !room || spectator) return;
    const code = room.code;
    void resumeSplendorSeat(code).catch(() => undefined);
    const timer = setInterval(() => {
      void postSplendorHeartbeat(code).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [screen, room?.code, spectator]);

  // 观战心跳（无凭证）。
  useEffect(() => {
    if (screen !== "play" || !spectator || !room) return;
    const timer = setInterval(() => {
      void fetchSplendorPresence(room.code).catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [screen, spectator, room?.code]);

  async function handleCreate(): Promise<void> {
    setBusy(true);
    try {
      const invite = await createSplendorRoom();
      setRoom(invite);
      setMySeatId("1");
      setSpectator(false);
      setScreen("room");
      window.history.replaceState(null, "", `/splendor/room/${invite.code}`);
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
      <div className="spl-app">
        {view ? (
          <SplendorTable
            view={view}
            roomCode={room.code}
            absences={absences}
            turnDeadline={turnDeadline ?? null}
            autoDecision={autoDecision ?? null}
            onError={showToast}
            onSubmitted={() => pollNowRef.current?.()}
            rematchPhase={room.phase}
            rematchSeats={room.seats ?? []}
            mySeatId={mySeatId}
            onRematch={async () => {
              try {
                await enterSplendorRematch(room.code);
                const invite = await fetchSplendorRoom(room.code);
                setRoom(invite);
                setScreen("room");
              } catch (e) {
                showToast(errorText(e));
              }
            }}
            onConfirmRematch={async () => {
              try {
                await confirmSplendorRematch(room.code);
                showToast("已确认续局");
              } catch (e) {
                showToast(errorText(e));
              }
            }}
            onSpectate={() => setSpectator(true)}
          />
        ) : (
          <div className="spl-loading">正在铺开丝绒桌面…</div>
        )}
        {pausedSeatId ? (
          <AbsenceOverlay
            code={room.code}
            seatId={pausedSeatId}
            isHost={mySeatId === "1"}
            absences={absences}
            onDismiss={() => setPausedSeatId(null)}
            onError={showToast}
          />
        ) : null}
        {error ? <div className="spl-toast">{error}</div> : null}
      </div>
    );
  }

  if (screen === "room" && room) {
    const isHost = mySeatId === "1";
    return (
      <>
        <GameRoomScreen
          game="splendor"
          homeHref="/splendor"
          title="璀璨宝石"
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
              await renameSplendorSeat(room.code, mySeatId, displayName);
            } catch {
              /* 改名失败不打扰 */
            }
          }}
          onClaim={async (seatId) => {
            try {
              const result = await claimSplendorSeat(room.code, seatId, displayName);
              setMySeatId(result.seat.seatId);
              setSpectator(false);
              const invite = await fetchSplendorRoom(room.code);
              setRoom(invite);
              showToast(`已就座 ${seatId} 号`);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          onConfigure={async (seatId, kind) => {
            try {
              await configureSplendorSeat(room.code, seatId, kind);
              const invite = await fetchSplendorRoom(room.code);
              setRoom(invite);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          onLeaveSeat={async () => {
            try {
              await leaveSplendorSeat(room.code);
              setRoom(null);
              setMySeatId(null);
              setScreen("home");
              window.history.replaceState(null, "", "/splendor");
              showToast("已让出座位，可以随时重新入座");
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          onStart={async () => {
            try {
              await startSplendorMatchOn(room.code);
              setScreen("play");
              setSpectator(false);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          startLabel="开 局"
          turnTimeLimitSec={room.turnTimeLimitSec ?? 60}
          onTurnTimeLimitChange={async (sec) => {
            try {
              await updateSplendorSettings(room.code, sec);
              const invite = await fetchSplendorRoom(room.code);
              setRoom(invite);
            } catch (e) {
              showToast(errorText(e));
            }
          }}
          hostHint="空位将在开局时自动关闭；率先 15 分者胜。"
          waitingNote="保持本页打开，掉线 15 秒内回到本页可自动回席。"
        />
        {error ? <div className="spl-toast">{error}</div> : null}
      </>
    );
  }

  // 大厅首页
  return (
    <>
      <GameHomeScreen
        game="splendor"
        backHref="/"
        title="璀璨宝石"
        subtitle="2–4 人 · 宝石与发展卡 · 率先 15 分折桂"
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
              await abandonSplendorRecovery(code);
              setRecoveryItems((items) => items.filter((i) => i.code !== code));
            } catch (e) {
              showToast(errorText(e));
            }
          })();
        }}
      />
      {error ? <div className="spl-toast">{error}</div> : null}
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
  absences: SplendorSeatAbsence[];
  onDismiss: () => void;
  onError: (m: string) => void;
}) {
  const absence = absences.find((a) => a.seatId === seatId);
  return (
    <div className="spl-overlay" role="dialog">
      <div className="spl-modal">
        <h3>{seatId} 号玩家离席</h3>
        <div className="spl-modal-body">
          <p>
            状态：{absence?.phase === "reconnecting" ? "重连中" : "离席"}。离席超过 5 分钟后房主可选择终止对局。
          </p>
        </div>
        {isHost ? (
          <div className="spl-actions-row">
            <button
              type="button"
              className="spl-btn spl-btn--ghost"
              onClick={async () => {
                try {
                  await postSplendorDisposition(code, seatId, "extend_wait");
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
              className="spl-btn spl-btn--danger"
              onClick={async () => {
                try {
                  await postSplendorDisposition(code, seatId, "technical_abort");
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
          <button type="button" className="spl-btn spl-btn--ghost" onClick={onDismiss}>
            知道了
          </button>
        )}
      </div>
    </div>
  );
}
