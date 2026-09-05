import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { CatanTable, RulesModal } from "./table/CatanTable.js";

/**
 * 卡坦岛应用壳：首页 → 创建房间 → 等待大厅 → 对局桌面。
 * 第一阶段为纯 Mock：房间与座位是本地状态，AI 玩家自动入座补位。
 */

type Visibility = "public" | "private";

interface LobbyState {
  code: string;
  name: string;
  visibility: Visibility;
  seatCount: 3 | 4;
  seats: Array<{ name: string; ready: boolean; isHuman: boolean; colorIndex: number }>;
}

type Screen = { name: "home" } | { name: "create" } | { name: "lobby" } | { name: "play" };

const NAME_KEY = "catan.playerName";

/** 深链 /catan/play 时的默认快速开局桌面（Mock：AI 衡位）。 */
function initialLobby(player: string): LobbyState {
  return {
    code: makeRoomCode(),
    name: "速开一桌",
    visibility: "private",
    seatCount: 4,
    seats: [
      { name: player, ready: true, isHuman: true, colorIndex: 0 },
      { name: "艾拉", ready: true, isHuman: false, colorIndex: 1 },
      { name: "马库斯", ready: true, isHuman: false, colorIndex: 2 },
      { name: "苏珊", ready: true, isHuman: false, colorIndex: 3 },
    ],
  };
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

function makeRoomCode(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export function CatanApp(): ReactElement {
  const deepPlay = window.location.pathname.startsWith("/catan/play");
  const [screen, setScreen] = useState<Screen>(() => (deepPlay ? { name: "play" } : { name: "home" }));
  const [playerName, setPlayerName] = useState(() => loadName());
  const [roomName, setRoomName] = useState("未名海湾");
  const [seatCount, setSeatCount] = useState<3 | 4>(4);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [lobby, setLobby] = useState<LobbyState | null>(() => (deepPlay ? initialLobby(loadName()) : null));
  const [joinCode, setJoinCode] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = screen.name === "play" ? "卡坦岛 · 对局" : "卡坦岛 CATAN";
  }, [screen]);

  const showToast = (text: string) => {
    setError(text);
    window.setTimeout(() => setError((cur) => (cur === text ? null : cur)), 3000);
  };

  // 等待大厅：AI 玩家陆续入座并准备。
  useEffect(() => {
    if (screen.name !== "lobby" || !lobby) return;
    if (lobby.seats.length >= lobby.seatCount) return;
    const AI_NAMES = ["艾拉", "马库斯", "苏珊"];
    const t = window.setTimeout(() => {
      setLobby((cur) => {
        if (!cur || cur.seats.length >= cur.seatCount) return cur;
        const idx = cur.seats.length;
        const name = AI_NAMES[(idx - 1 + AI_NAMES.length) % AI_NAMES.length]!;
        return { ...cur, seats: [...cur.seats, { name, ready: false, isHuman: false, colorIndex: idx }] };
      });
    }, 1000);
    return () => window.clearTimeout(t);
  }, [screen, lobby]);

  useEffect(() => {
    if (screen.name !== "lobby" || !lobby) return;
    const pending = lobby.seats.find((s) => !s.ready);
    if (!pending) return;
    const t = window.setTimeout(() => {
      setLobby((cur) => {
        if (!cur) return cur;
        return {
          ...cur,
          seats: cur.seats.map((s) => (s === pending ? { ...s, ready: true } : s)),
        };
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [screen, lobby]);

  const createRoom = () => {
    const name = roomName.trim() || "未名海湾";
    setLobby({ code: makeRoomCode(), name, visibility, seatCount, seats: [{ name: playerName, ready: true, isHuman: true, colorIndex: 0 }] });
    setScreen({ name: "lobby" });
  };

  const quickPlay = () => {
    const trimmed = playerName.trim() || "旅人";
    saveName(trimmed);
    setLobby({
      code: makeRoomCode(),
      name: "速开一桌",
      visibility: "private",
      seatCount: 4,
      seats: [
        { name: trimmed, ready: true, isHuman: true, colorIndex: 0 },
        { name: "艾拉", ready: true, isHuman: false, colorIndex: 1 },
        { name: "马库斯", ready: true, isHuman: false, colorIndex: 2 },
        { name: "苏珊", ready: true, isHuman: false, colorIndex: 3 },
      ],
    });
    setGameKey((k) => k + 1);
    setScreen({ name: "play" });
  };

  const joinRoom = () => {
    const code = joinCode.trim();
    if (!/^\d{4}$/.test(code)) {
      showToast("请输入 4 位房号");
      return;
    }
    // Mock：任意 4 位房号都能进一张由 AI 坐镇的桌子。
    setLobby({
      code,
      name: "海角圆桌",
      visibility: "public",
      seatCount: 4,
      seats: [
        { name: playerName.trim() || "旅人", ready: true, isHuman: true, colorIndex: 0 },
        { name: "马库斯", ready: true, isHuman: false, colorIndex: 1 },
      ],
    });
    setJoinCode("");
    setScreen({ name: "lobby" });
  };

  if (screen.name === "play" && lobby) {
    return (
      <CatanTable
        key={gameKey}
        playerName={playerName.trim() || "旅人"}
        seatCount={lobby.seatCount}
        roomCode={lobby.code}
        onExit={() => setScreen({ name: "lobby" })}
        onRestart={() => setGameKey((k) => k + 1)}
        demoWin={window.location.hash === "#demo-win"}
      />
    );
  }

  return (
    <div className="ct-app">
      <div className="ct-app-glow" aria-hidden="true" />
      {screen.name === "home" ? (
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
            <button type="button" className="ct-homebtn ct-homebtn--primary" onClick={quickPlay}>
              开 始 游 戏
              <small>与三位船长同桌，即刻开局</small>
            </button>
            <button type="button" className="ct-homebtn" onClick={() => setScreen({ name: "create" })}>
              创 建 房 间
              <small>摆好圆桌，等朋友入座</small>
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
                <button type="button" className="ct-homebtn ct-joinbtn" onClick={joinRoom}>
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
      ) : null}

      {screen.name === "create" ? (
        <main className="ct-create">
          <h1 className="ct-panel-title">创建房间</h1>
          <div className="ct-formcard">
            <label className="ct-formrow">
              <span>房间名称</span>
              <input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={16} placeholder="未名海湾" />
            </label>
            <div className="ct-formrow">
              <span>玩家人数</span>
              <div className="ct-seg">
                {[3, 4].map((n) => (
                  <button key={n} type="button" className={seatCount === n ? "is-active" : ""} onClick={() => setSeatCount(n as 3 | 4)}>
                    {n} 人
                  </button>
                ))}
              </div>
            </div>
            <div className="ct-formrow">
              <span>房间可见性</span>
              <div className="ct-seg">
                <button type="button" className={visibility === "public" ? "is-active" : ""} onClick={() => setVisibility("public")}>
                  公开
                </button>
                <button type="button" className={visibility === "private" ? "is-active" : ""} onClick={() => setVisibility("private")}>
                  私密
                </button>
              </div>
            </div>
            <div className="ct-formbtns">
              <button type="button" className="ct-actbtn ct-actbtn--primary" onClick={createRoom}>
                创建并等待
              </button>
              <button type="button" className="ct-actbtn" onClick={() => setScreen({ name: "home" })}>
                返回
              </button>
            </div>
          </div>
        </main>
      ) : null}

      {screen.name === "lobby" && lobby ? (
        <main className="ct-lobby">
          <p className="ct-lobby-kicker">{lobby.visibility === "public" ? "公开桌" : "私密桌"} · {lobby.name}</p>
          <h1 className="ct-lobby-code">
            房间 <b>{lobby.code}</b>
          </h1>
          <p className="ct-lobby-hint">把四位房号告诉朋友，或等船长们自行入座。</p>
          <ul className="ct-lobbyseats">
            {Array.from({ length: lobby.seatCount }, (_, i) => {
              const seat = lobby.seats[i];
              return (
                <li key={i} className={`ct-lobbyseat${seat ? " is-filled" : ""}${seat?.isHuman ? " is-you" : ""}`}>
                  <i className="ct-lobbyseat-chip" style={{ "--ci": i } as CSSProperties} aria-hidden="true" />
                  {seat ? (
                    <>
                      <b>{seat.name}</b>
                      {seat.isHuman ? <span className="ct-badge-you">你</span> : null}
                      <span className={`ct-lobbyseat-ready${seat.ready ? " is-ready" : ""}`}>
                        {seat.ready ? "✓ 已就绪" : "入座中…"}
                      </span>
                    </>
                  ) : (
                    <>
                      <b className="is-empty">虚位以待</b>
                      <span className="ct-lobbyseat-ready">等待中</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="ct-lobbybtns">
            <button
              type="button"
              className="ct-actbtn ct-actbtn--primary"
              disabled={lobby.seats.length < 2}
              title={lobby.seats.length < lobby.seatCount ? "座位未满，AI 将补位开局" : "全体就绪"}
              onClick={() => {
                setGameKey((k) => k + 1);
                setScreen({ name: "play" });
              }}
            >
              开始游戏{lobby.seats.length < lobby.seatCount ? "（AI 补位）" : ""}
            </button>
            <button type="button" className="ct-actbtn" onClick={() => setScreen({ name: "home" })}>
              解散并离开
            </button>
          </div>
        </main>
      ) : null}

      {rulesOpen ? <RulesModal onClose={() => setRulesOpen(false)} /> : null}
      {error ? <div className="ct-toast ct-toast--fixed">{error}</div> : null}
    </div>
  );
}
