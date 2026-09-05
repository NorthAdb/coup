import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { CatanCommand } from "@coup/catan-domain";
import { CatanTable, RulesModal } from "./table/CatanTable.js";
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
  type CatanLobbySeat,
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

const TURN_TIME_CHOICES = [0, 30, 60, 90, 120];
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
    const seats = room.seats ?? [];
    const filled = seats.filter((s) => s.kind === "local_human" || s.kind === "remote_human" || s.kind === "bot").length;
    const openRemain = seats.some((s) => s.kind === "open");
    const rematchStatus = room.phase === "rematch";
    return (
      <div className="ct-app">
        <div className="ct-app-glow" aria-hidden="true" />
        <main className="ct-lobby">
          <p className="ct-lobby-kicker">卡坦岛 · 房间号</p>
          <h1 className="ct-lobby-code">
            <b>{room.code}</b>
          </h1>
          <p className="ct-lobby-hint">
            把四位房号告诉朋友，访问 <code>{`${window.location.origin}/catan/join?code=${room.code}`}</code> 入座；
            缺的座位可以交给 AI 船长。
          </p>
          <div className="ct-lobbybtns" style={{ justifyContent: "center" }}>
            <button
              type="button"
              className="ct-actbtn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(`${window.location.origin}/catan/join?code=${room.code}`);
                  showToast("邀请链接已复制");
                } catch {
                  showToast("复制失败，请手动复制房号");
                }
              }}
            >
              复制邀请链接
            </button>
          </div>
          <ul className="ct-lobbyseats">
            {seats.map((seat) => (
              <LobbySeatRow
                key={seat.seatId}
                seat={seat}
                isHost={isHost}
                isMe={mySeatId === seat.seatId}
                onClaim={() => void handleClaimSeat(seat.seatId)}
                onConfigure={(kind) => void handleConfigure(seat.seatId, kind)}
                onLeave={() => void handleLeaveSeat()}
                displayName={displayName || "旅人"}
                onRename={async (name) => {
                  setDisplayName(name);
                  saveName(name);
                  try {
                    await renameCatanSeat(room.code, seat.seatId, name);
                  } catch {
                    /* 改名失败不打扰 */
                  }
                }}
              />
            ))}
          </ul>
          {rematchStatus ? (
            mySeatId != null && mySeatId !== "1" ? (
              <div className="ct-lobbybtns">
                <button
                  type="button"
                  className="ct-actbtn ct-actbtn--primary"
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
                  className="ct-actbtn"
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
            ) : (
              <p className="ct-lobby-hint">等待客人确认加入续局…</p>
            )
          ) : isHost && room.phase === "lobby" ? (
            <div className="ct-lobbybtns">
              <label className="ct-timelimit" title="回合限时">
                回合限时
                <select
                  value={String(room.turnTimeLimitSec ?? 60)}
                  onChange={(e) => void handleSettings(Number(e.target.value))}
                >
                  {TURN_TIME_CHOICES.map((sec) => (
                    <option key={sec} value={String(sec)}>
                      {sec === 0 ? "不限时" : `${sec} 秒`}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ct-actbtn ct-actbtn--primary"
                disabled={busy}
                title={openRemain ? "仍有开放空位，开局时会自动关闭" : "全体就绪"}
                onClick={() => void handleStart()}
              >
                开始游戏
              </button>
              <button
                type="button"
                className="ct-actbtn"
                onClick={() => {
                  setRoom(null);
                  setMySeatId(null);
                  setScreen("home");
                  window.history.replaceState(null, "", "/catan");
                }}
              >
                解散并离开
              </button>
            </div>
          ) : (
            <p className="ct-lobby-hint">
              {filled > 0 ? `已有 ${filled} 位就座` : "等待房主开局…"}
              {mySeatId == null ? " —— 点「就座」加入" : ""}
            </p>
          )}
        </main>
        {rulesOpen ? <RulesModal onClose={() => setRulesOpen(false)} /> : null}
        {error ? <div className="ct-toast ct-toast--fixed">{error}</div> : null}
      </div>
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

/* ------------------------------------------------------------------ */
/* 大厅座位卡                                                          */
/* ------------------------------------------------------------------ */

function LobbySeatRow({
  seat,
  isHost,
  isMe,
  onClaim,
  onConfigure,
  onLeave,
  displayName,
  onRename,
}: {
  seat: CatanLobbySeat;
  isHost: boolean;
  isMe: boolean;
  onClaim: () => void;
  onConfigure: (kind: "open" | "closed" | "bot") => void;
  onLeave: () => void;
  displayName: string;
  onRename: (name: string) => void;
}): ReactElement {
  const isYou = seat.kind === "local_human";
  const label =
    seat.kind === "local_human"
      ? "房主（你）"
      : seat.kind === "remote_human"
        ? `${seat.displayName ?? "客人"}${isMe ? "（你）" : ""}`
        : seat.kind === "bot"
          ? `🤖 ${seat.displayName ?? "AI 队友"}`
          : seat.kind === "open"
            ? "虚位以待"
            : "已关闭";
  return (
    <li className={`ct-lobbyseat${seat.kind !== "open" && seat.kind !== "closed" ? " is-filled" : ""}${isYou || (isMe && seat.kind === "remote_human") ? " is-you" : ""}${seat.kind === "bot" ? " is-bot" : ""}`}>
      <i className="ct-lobbyseat-chip" style={{ "--ci": Number(seat.seatId) - 1 } as CSSProperties} aria-hidden="true" />
      <b className={seat.kind === "open" || seat.kind === "closed" ? "is-empty" : ""}>{label}</b>
      {isYou ? (
        <input
          className="ct-lobbyseat-name"
          value={displayName}
          maxLength={12}
          onChange={(e) => onRename(e.target.value)}
          aria-label="你的名字"
        />
      ) : null}
      {seat.rematchStatus === "confirmed" ? <span className="ct-badge-you">已确认</span> : null}
      {isHost && seat.seatId !== "1" && seat.kind === "open" ? (
        <span className="ct-lobbyseat-actions">
          <button type="button" className="ct-actbtn ct-actbtn--small" onClick={onConfigure.bind(null, "bot")}>
            加AI
          </button>
          <button type="button" className="ct-actbtn ct-actbtn--small" onClick={onConfigure.bind(null, "closed")}>
            关闭
          </button>
        </span>
      ) : null}
      {isHost && seat.kind === "bot" ? (
        <span className="ct-lobbyseat-actions">
          <button type="button" className="ct-actbtn ct-actbtn--small" onClick={onConfigure.bind(null, "open")}>
            撤下AI
          </button>
        </span>
      ) : null}
      {isHost && seat.kind === "closed" ? (
        <span className="ct-lobbyseat-actions">
          <button type="button" className="ct-actbtn ct-actbtn--small" onClick={onConfigure.bind(null, "open")}>
            重新开放
          </button>
        </span>
      ) : null}
      {!isHost && seat.kind === "open" && !isMe ? (
        <span className="ct-lobbyseat-actions">
          <button type="button" className="ct-actbtn ct-actbtn--small" onClick={onClaim}>
            就座
          </button>
        </span>
      ) : null}
      {isMe && seat.kind === "remote_human" ? (
        <span className="ct-lobbyseat-actions">
          <button type="button" className="ct-actbtn ct-actbtn--small" onClick={onLeave}>
            让出座位
          </button>
        </span>
      ) : null}
    </li>
  );
}
