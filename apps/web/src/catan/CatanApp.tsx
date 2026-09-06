import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { CatanCommand } from "@coup/catan-domain";
import { CatanTable, RulesModal } from "./table/CatanTable.js";
import { GameRoomScreen } from "../platform/RoomUi.js";
import {
  catanErrorText,
  claimCatanSeat,
  configureCatanSeat,
  confirmCatanRematch,
  createCatanRoom,
  declineCatanRematch,
  enterCatanRematch,
  fetchCatanMatch,
  fetchCatanRoom,
  fetchMyCatanSeat,
  leaveCatanSeat,
  postCatanHeartbeat,
  renameCatanSeat,
  resumeCatanSeat,
  startCatanMatchOn,
  submitCatanCommand,
  updateCatanSettings,
  type CatanMatchPollBody,
  type CatanRoomInvite,
  type CatanView,
} from "./catanApi.js";

/**
 * 卡坦岛应用壳（ADR-0010 平台栈）：首页 → 创建/加入房间 → 等待大厅 → 对局桌面。
 * 房间、座位、心跳、续局全部走 /api/catan 平台端点；「开始游戏」一键
 * 与三位 AI 船长同桌（服务器 bot 座位），也可以留空位等朋友。
 */

type Screen = "home" | "room" | "play";

const NAME_KEY = "catan.playerName";

function initialScreen(): { screen: Screen; code: string | null } {
  const path = window.location.pathname;
  const roomMatch = path.match(/^\/catan\/room\/(\d{4})$/);
  if (roomMatch) return { screen: "room", code: roomMatch[1]! };
  const join = new URLSearchParams(window.location.search).get("code");
  if (path.startsWith("/catan/join") && join && /^\d{4}$/.test(join)) {
    return { screen: "home", code: join };
  }
  return { screen: "home", code: null };
}

function loadName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) || "旅人";
  } catch {
    return "旅人";
  }
}

function saveName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 私密模式忽略 */
  }
}

export function CatanApp(): ReactElement {
  const initial = useRef(initialScreen());
  const [screen, setScreen] = useState<Screen>(initial.current.screen);
  const [room, setRoom] = useState<CatanRoomInvite | null>(null);
  const [mySeatId, setMySeatId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => loadName() || "旅人");
  const [playerName, setPlayerName] = useState(() => loadName());
  const [view, setView] = useState<CatanView | null>(null);
  const [absences, setAbsences] = useState<CatanMatchPollBody["absences"]>([]);
  const [pausedSeatId, setPausedSeatId] = useState<string | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<CatanMatchPollBody["turnDeadline"]>(null);
  const [autoDecision, setAutoDecision] = useState<CatanMatchPollBody["autoDecision"]>(null);
  const [spectator, setSpectator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState(initial.current.code ?? "");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showToast = useCallback((text: string) => {
    setError(text);
    window.setTimeout(() => setError((cur) => (cur === text ? null : cur)), 3200);
  }, []);

  useEffect(() => {
    document.title = screen === "play" ? "卡坦岛 · 对局" : "卡坦岛 CATAN";
  }, [screen]);

  const refreshRoom = useCallback(async (code: string): Promise<CatanRoomInvite | null> => {
    try {
      const invite = await fetchCatanRoom(code);
      setRoom(invite);
      return invite;
    } catch (e) {
      if ((e as { status?: number }).status === 404) {
        setRoom(null);
        setView(null);
        setScreen("home");
        showToast("房间已解散或已被回收");
        window.history.replaceState(null, "", "/catan");
        return null;
      }
      showToast(catanErrorText(e));
      return null;
    }
  }, [showToast]);

  // 深链进房。
  useEffect(() => {
    const code = initial.current.code;
    if (!code || !/^\d{4}$/.test(code)) return;
    void (async () => {
      const invite = await fetchCatanRoom(code).catch(() => null);
      if (!invite) {
        showToast("房间不存在或已被回收");
        window.history.replaceState(null, "", "/catan");
        return;
      }
      setRoom(invite);
      const me = await fetchMyCatanSeat(code).catch(() => null);
      if (me?.seat) {
        setMySeatId(me.seat.seatId);
        setSpectator(false);
      }
      setScreen(invite.phase === "match" && me?.seat ? "play" : "room");
    })();
  }, [showToast]);

  // 大厅轮询。
  useEffect(() => {
    if (screen !== "room" || !room) return;
    const code = room.code;
    let alive = true;
    const timer = window.setInterval(async () => {
      const invite = await refreshRoom(code);
      if (!alive || !invite) return;
      if (invite.phase === "match") {
        setScreen((cur) => (cur === "play" ? cur : "play"));
      }
    }, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [screen, room?.code, refreshRoom]);

  // 对局轮询（增量）。
  useEffect(() => {
    if (screen !== "play" || !room) return;
    const code = room.code;
    let alive = true;
    let lastVersion: number | null = null;
    const poll = async () => {
      try {
        const query = spectator ? { spectate: true } : lastVersion != null ? { since: lastVersion } : undefined;
        const body = await fetchCatanMatch(code, query);
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
        if (!alive) return;
        if ((e as { status?: number }).status === 404) {
          // 对局被技术性中止或房间被回收：退回大厅/首页。
          setView(null);
          const invite = await refreshRoom(code);
          setScreen(invite ? "room" : "home");
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      if (!alive) return;
      void poll();
    }, 1400);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [screen, room?.code, spectator, refreshRoom]);

  // 回席 + 心跳。
  useEffect(() => {
    if (screen !== "play" || !room || spectator || !mySeatId) return;
    const code = room.code;
    void resumeCatanSeat(code).catch(() => undefined);
    const timer = window.setInterval(() => {
      void postCatanHeartbeat(code).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [screen, room?.code, spectator, mySeatId]);

  const handleCreate = async (): Promise<void> => {
    setBusy(true);
    try {
      const invite = await createCatanRoom();
      setRoom(invite);
      setMySeatId("1");
      setSpectator(false);
      setScreen("room");
      window.history.replaceState(null, "", `/catan/room/${invite.code}`);
    } catch (e) {
      showToast(catanErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  /** 一键开局：建房 + 三个 AI 衡位 + 直接开始（一个人也能玩）。 */
  const handleQuickPlay = async (): Promise<void> => {
    const trimmed = playerName.trim() || "旅人";
    saveName(trimmed);
    setBusy(true);
    try {
      const invite = await createCatanRoom();
      for (const seatId of ["2", "3", "4"]) {
        await configureCatanSeat(invite.code, seatId, "bot");
      }
      await renameCatanSeat(invite.code, "1", trimmed);
      await startCatanMatchOn(invite.code);
      setRoom(invite);
      setMySeatId("1");
      setSpectator(false);
      setScreen("play");
      window.history.replaceState(null, "", `/catan/room/${invite.code}`);
    } catch (e) {
      showToast(catanErrorText(e));
      // 快速开局失败时尽量回收到大厅界面。
      setScreen("home");
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async (): Promise<void> => {
    const code = joinCode.trim();
    if (!/^\d{4}$/.test(code)) {
      showToast("请输入 4 位房号");
      return;
    }
    setBusy(true);
    try {
      const invite = await fetchCatanRoom(code);
      setRoom(invite);
      const me = await fetchMyCatanSeat(code);
      if (me.seat) setMySeatId(me.seat.seatId);
      setScreen(invite.phase === "match" && me.seat ? "play" : "room");
      window.history.replaceState(null, "", `/catan/room/${code}`);
    } catch (e) {
      showToast(catanErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const handleClaimSeat = async (seatId: string): Promise<void> => {
    if (!room) return;
    try {
      const result = await claimCatanSeat(room.code, seatId, displayName || "旅人");
      setMySeatId(result.seat.seatId);
      setSpectator(false);
      const invite = await fetchCatanRoom(room.code);
      setRoom(invite);
      showToast(`已就座 ${seatId} 号`);
    } catch (e) {
      showToast(catanErrorText(e));
    }
  };

  const handleConfigure = async (seatId: string, kind: "open" | "closed" | "bot"): Promise<void> => {
    if (!room) return;
    try {
      await configureCatanSeat(room.code, seatId, kind);
      const invite = await fetchCatanRoom(room.code);
      setRoom(invite);
    } catch (e) {
      showToast(catanErrorText(e));
    }
  };

  const handleLeaveSeat = async (): Promise<void> => {
    if (!room) return;
    try {
      await leaveCatanSeat(room.code);
      setRoom(null);
      setMySeatId(null);
      setScreen("home");
      window.history.replaceState(null, "", "/catan");
      showToast("已让出座位");
    } catch (e) {
      showToast(catanErrorText(e));
    }
  };

  const handleStart = async (): Promise<void> => {
    if (!room) return;
    setBusy(true);
    try {
      await startCatanMatchOn(room.code);
      const invite = await fetchCatanRoom(room.code);
      setRoom(invite);
      setScreen("play");
    } catch (e) {
      showToast(catanErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSettings = async (turnTimeLimitSec: number): Promise<void> => {
    if (!room) return;
    try {
      await updateCatanSettings(room.code, turnTimeLimitSec);
      const invite = await fetchCatanRoom(room.code);
      setRoom(invite);
    } catch (e) {
      showToast(catanErrorText(e));
    }
  };

  const submitCommand = useCallback(
    async (command: CatanCommand): Promise<boolean> => {
      if (!room || !view || !mySeatId) return false;
      try {
        const body = await submitCatanCommand(
          room.code,
          command,
          `req-${view.stateVersion}-${Math.random().toString(36).slice(2, 8)}`,
          view.stateVersion,
        );
        if (body.view) setView(body.view);
        return true;
      } catch (e) {
        showToast(catanErrorText(e));
        return false;
      }
    },
    [room, view, mySeatId, showToast],
  );

  if (screen === "play" && room) {
    return (
      <div className="ct-app">
        {view ? (
          <CatanTable
            roomCode={room.code}
            view={view}
            mySeatId={spectator ? null : mySeatId}
            absences={absences ?? []}
            pausedSeatId={pausedSeatId}
            turnDeadline={turnDeadline ?? null}
            autoDecision={autoDecision ?? null}
            onSubmit={submitCommand}
            onExit={async () => {
              // 对局进行中房间 phase 恒为 match，回房间大厅会被轮询弹回对局；
              // 「离开」语义=退出本局回到首页（房间可凭房号/邀请链接重进）。
              setScreen("home");
              setView(null);
              window.history.replaceState(null, "", "/catan");
            }}
            onRematch={async () => {
              try {
                await enterCatanRematch(room.code);
                const invite = await fetchCatanRoom(room.code);
                setRoom(invite);
                setScreen("room");
              } catch (e) {
                showToast(catanErrorText(e));
              }
            }}
            onConfirmRematch={async () => {
              try {
                await confirmCatanRematch(room.code);
                showToast("已确认续局");
              } catch (e) {
                showToast(catanErrorText(e));
              }
            }}
            onDeclineRematch={async () => {
              try {
                await declineCatanRematch(room.code);
                showToast("已离开续局等待");
              } catch (e) {
                showToast(catanErrorText(e));
              }
            }}
          />
        ) : (
          <main className="ct-home">
            <h1 className="ct-home-title">正在载入对局…</h1>
          </main>
        )}
        {error ? <div className="ct-toast ct-toast--fixed">{error}</div> : null}
      </div>
    );
  }

  if (screen === "room" && room) {
    const isHost = mySeatId === "1";
    return (
      <>
        <GameRoomScreen
          game="catan"
          homeHref="/catan"
          title="卡坦岛"
          code={room.code}
          seats={room.seats ?? []}
          phase={room.phase}
          isHost={isHost}
          mySeatId={mySeatId}
          busy={busy}
          displayName={displayName}
          onDisplayNameChange={(name) => {
            setDisplayName(name);
            saveName(name);
          }}
          onRename={async () => {
            if (!mySeatId) return;
            try {
              await renameCatanSeat(room.code, mySeatId, displayName);
            } catch {
              /* 改名失败不打扰 */
            }
          }}
          onClaim={(seatId) => void handleClaimSeat(seatId)}
          onConfigure={(seatId, kind) => void handleConfigure(seatId, kind)}
          onLeaveSeat={() => void handleLeaveSeat()}
          onStart={() => void handleStart()}
          startLabel="开始游戏"
          minSeats={3}
          turnTimeLimitSec={room.turnTimeLimitSec ?? 60}
          onTurnTimeLimitChange={(sec) => void handleSettings(sec)}
          hostHint="空位将在开局时自动关闭；缺的座位也可以交给 AI 船长。"
          waitingNote="保持本页打开，掉线 15 秒内回到本页可自动回席。"
          rematchSlot={
            <section className="proom-panel">
              <h3 className="proom-panel-title">续局等待</h3>
              {isHost ? (
                <p className="proom-hint">等待客人确认加入续局；全员确认后点「开始游戏」开新局。</p>
              ) : (
                <div className="proom-chiprow">
                  <button
                    type="button"
                    className="proom-btn proom-btn--primary"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await confirmCatanRematch(room.code);
                        showToast("已确认续局，等房主开局");
                      } catch (e) {
                        showToast(catanErrorText(e));
                      }
                    }}
                  >
                    确认加入续局
                  </button>
                  <button
                    type="button"
                    className="proom-btn"
                    disabled={busy}
                    onClick={async () => {
                      try {
                        await declineCatanRematch(room.code);
                        showToast("已离开续局等待");
                      } catch (e) {
                        showToast(catanErrorText(e));
                      }
                    }}
                  >
                    离开
                  </button>
                </div>
              )}
            </section>
          }
        />
        {error ? <div className="ct-toast ct-toast--fixed">{error}</div> : null}
      </>
    );
  }

  return (
    <div className="ct-app">
      <div className="ct-app-glow" aria-hidden="true" />
      <main className="ct-home">
        <div className="ct-home-art" aria-hidden="true">
          <i className="ct-art-hex ct-art-hex--1" />
          <i className="ct-art-hex ct-art-hex--2" />
          <i className="ct-art-hex ct-art-hex--3" />
          <i className="ct-art-ship" />
        </div>
        <p className="ct-home-kicker">3–4 人 · 探索与经营 · HEX ISLANDS</p>
        <h1 className="ct-home-title">卡坦岛</h1>
        <p className="ct-home-lede">
          一片丰饶的无人岛：伐木、烧砖、牧羊、种麦、采矿。修路筑村、以物易物，
          在骰子的潮汐与强盗的阴影里，率先建起属于你的十座荣光。
        </p>
        <div className="ct-home-actions">
          <button type="button" className="ct-homebtn ct-homebtn--primary" disabled={busy} onClick={() => void handleQuickPlay()}>
            开 始 游 戏
            <small>与三位 AI 船长同桌，即刻开局</small>
          </button>
          <button type="button" className="ct-homebtn" disabled={busy} onClick={() => void handleCreate()}>
            创 建 房 间
            <small>摆好圆桌，等朋友或 AI 入座</small>
          </button>
          <div className="ct-joinbox">
            <div className="ct-joinrow">
              <input
                className="ct-joininput"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="房号"
                inputMode="numeric"
                aria-label="4 位房号"
              />
              <button type="button" className="ct-homebtn ct-joinbtn" disabled={busy} onClick={() => void handleJoin()}>
                加 入 房 间
              </button>
            </div>
            <small>输入四位房号，登上那座岛</small>
          </div>
          <button type="button" className="ct-homebtn ct-homebtn--ghost" onClick={() => setRulesOpen(true)}>
            玩 法 说 明
            <small>骰子、资源与强盗的规矩</small>
          </button>
        </div>
        <label className="ct-nameline">
          你的名字
          <input
            value={playerName}
            onChange={(e) => {
              setPlayerName(e.target.value);
              saveName(e.target.value);
            }}
            maxLength={12}
          />
        </label>
      </main>
      {rulesOpen ? <RulesModal onClose={() => setRulesOpen(false)} /> : null}
      {error ? <div className="ct-toast ct-toast--fixed">{error}</div> : null}
    </div>
  );
}
