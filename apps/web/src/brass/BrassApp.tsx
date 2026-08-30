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
import { loadPlayerName, savePlayerName } from "../lanRoom.js";

type Screen = "home" | "room" | "play";

const TURN_TIME_CHOICES = [0, 30, 60, 90, 120];

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
      } catch {
        // 404 → 房间已被清扫
      }
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [screen, room?.code]);

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
        if (body.view?.state.phase && body.view.state.status === "in_progress" && !spectator) {
          // 保持对局态。
        }
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
                await confirmBrassRematch(room.code, mySeatId ?? "");
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
      <div className="brass-shell">
        <header className="brass-shell-header">
          <span className="brass-brand">工业革命 · 伯明翰</span>
          <span className="brass-shell-room">房间号 {room.code}</span>
        </header>
        <main className="brass-room">
          <section className="brass-panel brass-invite">
            <h3>邀请好友</h3>
            <div className="brass-invite-code">{room.code}</div>
            <p className="brass-hint">
              好友访问 <code>{`${window.location.origin}/brass/join?code=${room.code}`}</code> 或在本页输入房间号加入。
            </p>
            <button
              type="button"
              className="brass-ghost-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/brass/join?code=${room.code}`);
                  showToast("链接已复制");
                } catch {
                  showToast("复制失败，请手动复制");
                }
              }}
            >
              复制邀请链接
            </button>
          </section>

          <section className="brass-panel brass-seats">
            <h3>座位（2–4 人）</h3>
            {(room.seats ?? []).map((seat) => (
              <div key={seat.seatId} className="brass-seat-row">
                <span className="brass-seat-id">{seat.seatId} 号</span>
                {seat.kind === "local_human" ? (
                  <>
                    <span className="brass-seat-name">房主（你）</span>
                    <input
                      className="brass-name-input"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      onBlur={async () => {
                        savePlayerName(displayName);
                        try {
                          await renameBrassSeat(room.code, seat.seatId, displayName);
                        } catch {
                          /* ignore */
                        }
                      }}
                    />
                  </>
                ) : seat.kind === "remote_human" ? (
                  <span className="brass-seat-name">{seat.displayName ?? "客人"}</span>
                ) : (
                  <span className="brass-seat-name dim">{seat.kind === "open" ? "空位" : "已关闭"}</span>
                )}
                {isHost && seat.seatId !== "1" && room.phase === "lobby" ? (
                  <button
                    type="button"
                    className="brass-ghost-btn"
                    onClick={async () => {
                      try {
                        await configureBrassSeat(room.code, seat.seatId, seat.kind === "open" ? "closed" : "open");
                        const invite = await fetchBrassRoom(room.code);
                        setRoom(invite);
                      } catch (e) {
                        showToast(errorText(e));
                      }
                    }}
                  >
                    {seat.kind === "open" ? "关闭" : "开放"}
                  </button>
                ) : null}
                {!isHost && seat.kind === "open" ? (
                  <button
                    type="button"
                    className="brass-ghost-btn"
                    onClick={async () => {
                      try {
                        const result = await claimBrassSeat(room.code, seat.seatId, displayName);
                        setMySeatId(result.seat.seatId);
                        const invite = await fetchBrassRoom(room.code);
                        setRoom(invite);
                        showToast(`已就座 ${seat.seatId} 号`);
                      } catch (e) {
                        showToast(errorText(e));
                      }
                    }}
                  >
                    就座
                  </button>
                ) : null}
                {mySeatId === seat.seatId && seat.kind === "remote_human" ? (
                  <span className="brass-hint">（你）</span>
                ) : null}
              </div>
            ))}
          </section>

          {isHost ? (
            <section className="brass-panel brass-settings">
              <h3>回合计时</h3>
              <div className="brass-settings-row">
                {TURN_TIME_CHOICES.map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    className={`brass-ghost-btn ${(room.turnTimeLimitSec ?? 60) === sec ? "active" : ""}`}
                    onClick={async () => {
                      try {
                        await updateBrassSettings(room.code, sec);
                        const invite = await fetchBrassRoom(room.code);
                        setRoom(invite);
                      } catch (e) {
                        showToast(errorText(e));
                      }
                    }}
                  >
                    {sec === 0 ? "不限时" : `${sec} 秒`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="brass-primary-btn"
                disabled={busy}
                onClick={async () => {
                  try {
                    await startBrassMatchOn(room.code);
                    setScreen("play");
                    setSpectator(false);
                  } catch (e) {
                    showToast(errorText(e));
                  }
                }}
              >
                开始对局
              </button>
              <p className="brass-hint">运河时代第 1 回合每人 1 个行动，之后每回合 2 个行动。</p>
            </section>
          ) : (
            <section className="brass-panel brass-settings">
              <h3>等待房主开局</h3>
              {mySeatId ? (
                <p className="brass-hint">你已就座 {mySeatId} 号。保持本页打开，掉线后 15 秒内回到本页可自动回席。</p>
              ) : (
                <div className="brass-settings-row">
                  {(room.seats ?? [])
                    .filter((s) => s.kind === "open")
                    .map((s) => (
                      <button
                        key={s.seatId}
                        type="button"
                        className="brass-ghost-btn"
                        onClick={async () => {
                          try {
                            const result = await claimBrassSeat(room.code, s.seatId, displayName);
                            setMySeatId(result.seat.seatId);
                          } catch (e) {
                            showToast(errorText(e));
                          }
                        }}
                      >
                        就座 {s.seatId} 号
                      </button>
                    ))}
                  <button
                    type="button"
                    className="brass-ghost-btn"
                    onClick={() => {
                      setSpectator(true);
                      setScreen("play");
                    }}
                  >
                    观战
                  </button>
                </div>
              )}
            </section>
          )}
        </main>
        {error ? <div className="brass-toast">{error}</div> : null}
      </div>
    );
  }

  // 大厅首页
  return (
    <div className="brass-shell brass-lobby">
      <header className="brass-shell-header">
        <a className="brass-brand" href="/">
          ← 返回大厅
        </a>
        <span className="brass-shell-room">工业革命 · 伯明翰</span>
      </header>
      <main className="brass-room">
        <section className="brass-panel">
          <h3>创建房间</h3>
          <p className="brass-hint">2–4 人 · 运河与铁路两个时代 · 每回合 2 个行动</p>
          <button type="button" className="brass-primary-btn" disabled={busy} onClick={() => void handleCreate()}>
            创建新房间
          </button>
        </section>
        <section className="brass-panel">
          <h3>加入房间</h3>
          <div className="brass-join-row">
            <input
              className="brass-code-input"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 位房间号"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            <button type="button" className="brass-primary-btn" disabled={busy} onClick={() => void handleJoin()}>
              加入
            </button>
          </div>
          <div className="brass-name-row">
            <label className="brass-inline">
              昵称
              <input
                className="brass-name-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => savePlayerName(displayName)}
              />
            </label>
          </div>
        </section>
        {recoveryItems.length > 0 ? (
          <section className="brass-panel">
            <h3>中断的对局</h3>
            {recoveryItems.map((item) => (
              <div key={item.code} className="brass-recovery-row">
                <span>房间 {item.code}（{item.reason === "match_missing" ? "缺少对局" : "恢复失败"}）</span>
                <button
                  type="button"
                  className="brass-ghost-btn"
                  onClick={async () => {
                    try {
                      await abandonBrassRecovery(item.code);
                      setRecoveryItems((items) => items.filter((i) => i.code !== item.code));
                    } catch (e) {
                      showToast(errorText(e));
                    }
                  }}
                >
                  放弃
                </button>
              </div>
            ))}
          </section>
        ) : null}
      </main>
      {error ? <div className="brass-toast">{error}</div> : null}
    </div>
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
