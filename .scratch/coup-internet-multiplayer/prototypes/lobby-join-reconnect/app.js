/**
 * PROTOTYPE — Three variants of LAN lobby / join / reconnect IA + copy.
 * Question: 双入口 → 创建/加入 → 大厅门禁 → 离线等待/重连提示 应长什么样？
 * Switch via ?variant=A|B|C and the floating bar. Stub desk only.
 */

const VARIANTS = [
  { key: "A", name: "流程条" },
  { key: "B", name: "指挥台" },
  { key: "C", name: "圆桌场" },
];

const STEPS = [
  { id: "home", label: "入口" },
  { id: "join", label: "加入" },
  { id: "lobby", label: "大厅" },
  { id: "desk", label: "对局提示" },
];

const ROOM_CODE = "4821";
const LAN_HOST = "192.168.1.42";
const PORT = "8787";
const JOIN_URL = `http://${LAN_HOST}:${PORT}/join?code=${ROOM_CODE}`;

function initialSeats() {
  return [
    { id: 1, name: "你（主机）", kind: "local" },
    { id: 2, name: "阿黛尔", kind: "claimed" },
    { id: 3, name: "", kind: "open" },
    { id: 4, name: "OpenCode · glm", kind: "agent", agentReady: true },
    { id: 5, name: "", kind: "closed" },
    { id: 6, name: "", kind: "closed" },
  ];
}

const state = {
  variant: "A",
  scene: "home",
  role: "host",
  seats: initialSeats(),
  guestName: "客人",
  joinAddress: `${LAN_HOST}:${PORT}`,
  joinCode: ROOM_CODE,
  joinLink: JOIN_URL,
  selectedNic: `${LAN_HOST}`,
  nics: ["192.168.1.42", "10.0.0.8"],
  awaySeatId: null,
  awayPhase: null, // reconnecting | away | timed_out
  waitLeftSec: 0,
  toast: null,
  dispositionOpen: false,
};

function readVariant() {
  const key = new URLSearchParams(location.search).get("variant") ?? "A";
  return VARIANTS.some((v) => v.key === key) ? key : "A";
}

function setVariant(key) {
  const url = new URL(location.href);
  url.searchParams.set("variant", key);
  history.replaceState(null, "", url);
  state.variant = key;
  render();
}

function toast(msg) {
  state.toast = msg;
  render();
  setTimeout(() => {
    if (state.toast === msg) {
      state.toast = null;
      render();
    }
  }, 1800);
}

function effectiveSeats() {
  return state.seats.filter((s) => s.kind !== "closed");
}

function openSlots() {
  return state.seats.filter((s) => s.kind === "open");
}

function canStart() {
  const n = effectiveSeats().filter(
    (s) => s.kind === "local" || s.kind === "claimed" || s.kind === "agent",
  ).length;
  if (n < 2 || n > 6) return false;
  if (openSlots().length > 0) return false;
  const agents = state.seats.filter((s) => s.kind === "agent");
  return agents.every((s) => s.agentReady);
}

function startBlockHint() {
  if (openSlots().length > 0) return "仍有「开放占座」空槽，请占满、改 Agent 或关闭。";
  const n = effectiveSeats().filter(
    (s) => s.kind === "local" || s.kind === "claimed" || s.kind === "agent",
  ).length;
  if (n < 2) return "有效座位至少 2 人。";
  const notReady = state.seats.find((s) => s.kind === "agent" && !s.agentReady);
  if (notReady) return `座位 ${notReady.id} 的 Agent 未就绪，请重新检测。`;
  return null;
}

function goScene(scene) {
  state.scene = scene;
  if (scene === "home") {
    state.awaySeatId = null;
    state.awayPhase = null;
    state.dispositionOpen = false;
  }
  render();
}

function createRoom() {
  state.role = "host";
  state.seats = initialSeats();
  state.scene = "lobby";
  toast("已进入主机模式 · 绑定 0.0.0.0 · 打开 LAN URL");
  render();
}

function enterLocal() {
  toast("（原型）进入现有本机对战开局页 — 此处不展开");
}

function openJoin() {
  state.role = "guest";
  state.scene = "join";
  render();
}

function submitJoin() {
  if (!state.joinLink.trim() && !(state.joinAddress.trim() && state.joinCode.trim())) {
    toast("需要完整加入链接，或「地址 + 房间号」");
    return;
  }
  state.role = "guest";
  state.seats = initialSeats();
  // guest claims first open slot
  const open = state.seats.find((s) => s.kind === "open");
  if (open) {
    open.kind = "claimed";
    open.name = state.guestName || "客人";
  }
  state.scene = "lobby";
  toast(`已加入房间 ${ROOM_CODE}`);
  render();
}

function setSlotKind(seatId, kind) {
  if (state.role !== "host") return;
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat || seat.kind === "local") return;
  seat.kind = kind;
  if (kind === "open") seat.name = "";
  if (kind === "closed") seat.name = "";
  if (kind === "agent") {
    seat.name = "OpenCode · glm";
    seat.agentReady = true;
  }
  if (kind === "claimed") seat.name = seat.name || "远程玩家";
  render();
}

function claimAsGuest() {
  const open = state.seats.find((s) => s.kind === "open");
  if (!open) {
    toast("没有开放占座");
    return;
  }
  open.kind = "claimed";
  open.name = state.guestName || "客人";
  toast(`已占座位 ${open.id}`);
  render();
}

function startMatch() {
  if (!canStart()) {
    toast(startBlockHint() ?? "无法开局");
    return;
  }
  state.scene = "desk";
  state.awaySeatId = null;
  state.awayPhase = null;
  state.dispositionOpen = false;
  toast("对局开始（stub 桌）");
  render();
}

function simulateDisconnect() {
  const target =
    state.seats.find((s) => s.kind === "claimed") ??
    state.seats.find((s) => s.id === 2);
  if (!target) return;
  state.awaySeatId = target.id;
  state.awayPhase = "reconnecting";
  state.waitLeftSec = 15;
  state.dispositionOpen = false;
  toast(`${target.name || `座位 ${target.id}`} 连接中断 · 15 秒宽限`);
  render();
}

function advanceAway() {
  if (!state.awaySeatId) return;
  if (state.awayPhase === "reconnecting") {
    state.awayPhase = "away";
    state.waitLeftSec = 300;
    toast("宽限结束 · 标记离席 · 5 分钟软超时");
  } else if (state.awayPhase === "away") {
    state.awayPhase = "timed_out";
    state.waitLeftSec = 0;
    state.dispositionOpen = true;
    toast("软超时结束 · 主机必须处置");
  }
  render();
}

function guestReconnect() {
  if (!state.awaySeatId) return;
  toast("回席成功 · 座位凭证已轮换");
  state.awaySeatId = null;
  state.awayPhase = null;
  state.dispositionOpen = false;
  render();
}

function dispose(action) {
  const seat = state.seats.find((s) => s.id === state.awaySeatId);
  const label = seat?.name || `座位 ${state.awaySeatId}`;
  if (action === "wait") {
    state.awayPhase = "away";
    state.waitLeftSec = 300;
    state.dispositionOpen = false;
    toast("继续等待 · 再开 5 分钟（凭证不变）");
  } else if (action === "agent") {
    if (seat) {
      seat.kind = "agent";
      seat.name = "OpenCode · glm";
      seat.agentReady = true;
    }
    state.awaySeatId = null;
    state.awayPhase = null;
    state.dispositionOpen = false;
    toast(`${label} → 本机 Agent（旧凭证作废）`);
  } else if (action === "abort") {
    toast("技术故障中止整局 · 无胜者");
    goScene("home");
    return;
  } else if (action === "eliminate") {
    toast(`${label} 因离席被强制揭示淘汰 · 凭证作废`);
    if (seat) {
      seat.kind = "closed";
      seat.name = "";
    }
    state.awaySeatId = null;
    state.awayPhase = null;
    state.dispositionOpen = false;
  }
  render();
}

function formatWait(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function awayCopy() {
  if (!state.awayPhase) return null;
  const seat = state.seats.find((s) => s.id === state.awaySeatId);
  const who = seat?.name || `座位 ${state.awaySeatId}`;
  if (state.awayPhase === "reconnecting") {
    return {
      title: `${who} 重连中`,
      body: `实时通道断开，宽限 ${state.waitLeftSec}s。未轮到该座时其他座位可继续。`,
      tone: "warn",
    };
  }
  if (state.awayPhase === "away") {
    return {
      title: `${who} 已离席`,
      body: `软超时剩余 ${formatWait(state.waitLeftSec)}。若正轮到该座，对局在此决策点暂停。`,
      tone: "danger",
    };
  }
  return {
    title: `${who} 等待超时`,
    body: "主机须选择：继续等待 / 换本机 Agent / 技术中止 / 强制揭示淘汰。",
    tone: "danger",
  };
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function seatKindLabel(kind) {
  return (
    {
      local: "本地人类",
      open: "开放占座",
      claimed: "远程人类",
      agent: "本机 Agent",
      closed: "关闭",
    }[kind] ?? kind
  );
}

/* —— Shared chrome bits —— */

function demoBarHtml() {
  return `
    <aside class="demo-bar" aria-label="原型演示控制">
      <span class="demo-label">演示</span>
      <button type="button" data-act="scene" data-scene="home">入口</button>
      <button type="button" data-act="scene" data-scene="join">加入</button>
      <button type="button" data-act="scene" data-scene="lobby">大厅</button>
      <button type="button" data-act="scene" data-scene="desk">对局</button>
      <button type="button" data-act="role" data-role="host">主机视角</button>
      <button type="button" data-act="role" data-role="guest">客人视角</button>
      ${
        state.scene === "desk"
          ? `<button type="button" data-act="disconnect">模拟断线</button>
             <button type="button" data-act="advance-away">推进离席阶段</button>
             <button type="button" data-act="reconnect">客人回席</button>`
          : ""
      }
    </aside>
  `;
}

function switcherHtml() {
  const current = VARIANTS.find((v) => v.key === state.variant);
  return `
    <nav class="proto-switcher" aria-label="原型变体切换">
      <button type="button" data-act="prev-variant" aria-label="上一个变体">←</button>
      <span>${esc(state.variant)} — ${esc(current?.name ?? "")}</span>
      <button type="button" data-act="next-variant" aria-label="下一个变体">→</button>
    </nav>
  `;
}

function toastHtml() {
  if (!state.toast) return "";
  return `<div class="toast" role="status">${esc(state.toast)}</div>`;
}

function inviteBits() {
  return {
    code: ROOM_CODE,
    url: `http://${state.selectedNic}:${PORT}/join?code=${ROOM_CODE}`,
    nics: state.nics,
  };
}

/* ========== VARIANT A — 流程条 ========== */

function variantA() {
  const stepIndex = STEPS.findIndex((s) => s.id === state.scene);
  const steps = STEPS.map((s, i) => {
    const cls =
      i < stepIndex ? "done" : i === stepIndex ? "current" : "todo";
    return `<li class="step ${cls}"><span>${esc(s.label)}</span></li>`;
  }).join("");

  let body = "";
  if (state.scene === "home") body = aHome();
  else if (state.scene === "join") body = aJoin();
  else if (state.scene === "lobby") body = aLobby();
  else body = aDesk();

  return `
    <div class="var-a shell-a">
      <header class="a-top">
        <p class="eyebrow">PROTOTYPE · 局域网联机</p>
        <h1>政变</h1>
        <ol class="step-rail">${steps}</ol>
      </header>
      <main class="a-main">${body}</main>
    </div>
  `;
}

function aHome() {
  return `
    <section class="a-panel">
      <h2>你要怎么开一局？</h2>
      <p class="lede">本机对战与局域网房间分开进入；创建房间会重绑网卡并打开局域网地址。</p>
      <ol class="a-choices">
        <li><button type="button" class="primary" data-act="local">本机对战</button><span>你 + 本机 Agent，仅本机可进</span></li>
        <li><button type="button" class="primary" data-act="create">创建房间</button><span>你做主机，分享房间号或加入链接</span></li>
        <li><button type="button" class="primary" data-act="join">加入房间</button><span>粘贴链接，或填主机地址 + 房间号</span></li>
      </ol>
    </section>
  `;
}

function aJoin() {
  return `
    <section class="a-panel">
      <h2>加入房间</h2>
      <p class="lede">不能只填房间号。优先用主机发来的完整链接。</p>
      <label class="field">加入链接
        <input data-field="joinLink" value="${esc(state.joinLink)}" placeholder="http://192.168.x.x:8787/join?code=4821" />
      </label>
      <p class="or">或</p>
      <div class="field-row">
        <label class="field">主机地址
          <input data-field="joinAddress" value="${esc(state.joinAddress)}" />
        </label>
        <label class="field">房间号
          <input data-field="joinCode" value="${esc(state.joinCode)}" maxlength="4" />
        </label>
      </div>
      <label class="field">显示名
        <input data-field="guestName" value="${esc(state.guestName)}" />
      </label>
      <div class="actions">
        <button type="button" class="ghost" data-act="scene" data-scene="home">返回</button>
        <button type="button" class="primary" data-act="submit-join">进入大厅</button>
      </div>
    </section>
  `;
}

function aLobby() {
  const invite = inviteBits();
  const host = state.role === "host";
  const seats = state.seats
    .map((s) => {
      const controls = host && s.kind !== "local"
        ? `<select data-act="slot-kind" data-seat="${s.id}">
            <option value="open" ${s.kind === "open" ? "selected" : ""}>开放占座</option>
            <option value="claimed" ${s.kind === "claimed" ? "selected" : ""}>远程人类</option>
            <option value="agent" ${s.kind === "agent" ? "selected" : ""}>本机 Agent</option>
            <option value="closed" ${s.kind === "closed" ? "selected" : ""}>关闭</option>
          </select>`
        : "";
      const name =
        s.kind === "open"
          ? "等待加入…"
          : s.kind === "closed"
            ? "—"
            : esc(s.name || seatKindLabel(s.kind));
      return `<li class="a-seat kind-${s.kind}">
        <span class="idx">${s.id}</span>
        <div><strong>${name}</strong><em>${seatKindLabel(s.kind)}${
          s.kind === "agent" ? (s.agentReady ? " · 就绪" : " · 未就绪") : ""
        }</em></div>
        ${controls}
      </li>`;
    })
    .join("");

  const inviteBlock = host
    ? `<div class="a-invite">
        <div><span class="k">房间号</span><strong class="code">${invite.code}</strong></div>
        <div class="link-row">
          <code>${esc(invite.url)}</code>
          <button type="button" data-act="copy-link">复制链接</button>
        </div>
        <label class="field inline">网卡
          <select data-field="selectedNic">
            ${invite.nics.map((n) => `<option ${n === state.selectedNic ? "selected" : ""}>${esc(n)}</option>`).join("")}
          </select>
        </label>
      </div>`
    : `<p class="guest-note">你已占一座。可改显示名；开局由主机决定。</p>
       <label class="field">显示名
         <input data-field="guestName" value="${esc(state.guestName)}" />
       </label>
       <button type="button" data-act="claim">占一个开放座位</button>`;

  const gate = startBlockHint();
  return `
    <section class="a-panel lobby">
      <h2>${host ? "主机大厅" : "客人大厅"}</h2>
      ${inviteBlock}
      <ol class="a-seat-list">${seats}</ol>
      ${
        host
          ? `<div class="actions">
              <button type="button" class="ghost" data-act="probe">重新检测 Agent</button>
              <button type="button" class="primary" data-act="start" ${canStart() ? "" : "disabled"}>开始对局</button>
            </div>
            ${gate ? `<p class="hint">${esc(gate)}</p>` : `<p class="hint ok">门禁通过：有效座 2–6，无开放空槽，Agent 就绪。</p>`}`
          : `<p class="hint">等待主机开局…</p>`
      }
    </section>
  `;
}

function aDesk() {
  const away = awayCopy();
  const host = state.role === "host";
  return `
    <section class="a-panel desk-stub">
      <h2>对局中（stub）</h2>
      <p class="lede">复用现有策划桌；本原型只看离线提示信息架构。</p>
      <div class="stub-table">策划桌占位 · 左座位 / 中舞台 / 右记录</div>
      ${
        away
          ? `<div class="away-banner tone-${away.tone}">
              <strong>${esc(away.title)}</strong>
              <p>${esc(away.body)}</p>
              ${
                host && (state.awayPhase === "away" || state.awayPhase === "timed_out" || state.dispositionOpen)
                  ? dispositionButtons()
                  : state.role === "guest"
                    ? `<button type="button" data-act="reconnect">我已回席</button>`
                    : ""
              }
            </div>`
          : `<p class="hint">用演示栏「模拟断线」看 15s 宽限 → 离席 → 主机处置。</p>`
      }
    </section>
  `;
}

function dispositionButtons() {
  return `
    <div class="disp-actions">
      <button type="button" data-act="dispose" data-kind="wait">继续等待</button>
      <button type="button" data-act="dispose" data-kind="agent">换本机 Agent</button>
      <button type="button" data-act="dispose" data-kind="abort">技术中止</button>
      <button type="button" data-act="dispose" data-kind="eliminate">强制揭示淘汰</button>
    </div>
  `;
}

/* ========== VARIANT B — 指挥台 ========== */

function variantB() {
  if (state.scene === "home") return bHome();
  if (state.scene === "join") return bJoin();
  if (state.scene === "lobby") return bLobby();
  return bDesk();
}

function bHome() {
  return `
    <div class="var-b home-b">
      <div class="b-hero">
        <p class="eyebrow">局域网主机</p>
        <h1>创建房间</h1>
        <p>你做权威主机。分享 4 位房间号或加入链接；座位 1 永远是你。</p>
        <button type="button" class="primary xl" data-act="create">创建房间</button>
      </div>
      <aside class="b-side">
        <button type="button" class="side-card" data-act="join">
          <strong>加入房间</strong>
          <span>粘贴链接，或地址 + 房间号</span>
        </button>
        <button type="button" class="side-card ghost" data-act="local">
          <strong>本机对战</strong>
          <span>仅 loopback · 现有开局页</span>
        </button>
      </aside>
    </div>
  `;
}

function bJoin() {
  return `
    <div class="var-b join-b">
      <header>
        <button type="button" class="ghost" data-act="scene" data-scene="home">← 返回</button>
        <h1>加入</h1>
      </header>
      <div class="b-join-grid">
        <label class="field grow">粘贴加入链接
          <textarea data-field="joinLink" rows="3">${esc(state.joinLink)}</textarea>
        </label>
        <div class="manual">
          <p class="k">手动</p>
          <label class="field">主机 IP:端口
            <input data-field="joinAddress" value="${esc(state.joinAddress)}" />
          </label>
          <label class="field">房间号（4 位）
            <input class="code-input" data-field="joinCode" value="${esc(state.joinCode)}" maxlength="4" />
          </label>
        </div>
      </div>
      <label class="field">你的显示名
        <input data-field="guestName" value="${esc(state.guestName)}" />
      </label>
      <button type="button" class="primary xl" data-act="submit-join">进入大厅</button>
    </div>
  `;
}

function bLobby() {
  const host = state.role === "host";
  const invite = inviteBits();
  const matrix = state.seats
    .map((s) => {
      const hostCtrl =
        host && s.kind !== "local"
          ? `<div class="slot-modes">
              ${["open", "agent", "closed"]
                .map(
                  (k) =>
                    `<button type="button" class="${s.kind === k || (k === "open" && s.kind === "claimed") ? "on" : ""}" data-act="slot-kind" data-seat="${s.id}" data-kind="${k === "open" && s.kind === "claimed" ? "open" : k}">${
                      k === "open" ? (s.kind === "claimed" ? "已占" : "开放") : k === "agent" ? "Agent" : "关"
                    }</button>`,
                )
                .join("")}
            </div>`
          : "";
      return `<article class="seat-card kind-${s.kind}">
        <header><span>#${s.id}</span><em>${seatKindLabel(s.kind)}</em></header>
        <p class="name">${
          s.kind === "open"
            ? "空位 · 等待"
            : s.kind === "closed"
              ? "关闭"
              : esc(s.name)
        }</p>
        ${s.kind === "agent" ? `<p class="meta">${s.agentReady ? "就绪" : "未就绪"}</p>` : ""}
        ${hostCtrl}
      </article>`;
    })
    .join("");

  const left = host
    ? `<aside class="b-invite-pane">
        <p class="eyebrow">邀请</p>
        <p class="code-xl">${invite.code}</p>
        <button type="button" class="primary" data-act="copy-link">复制加入链接</button>
        <code class="url">${esc(invite.url)}</code>
        <label class="field">展示网卡
          <select data-field="selectedNic">
            ${invite.nics.map((n) => `<option ${n === state.selectedNic ? "selected" : ""}>${esc(n)}</option>`).join("")}
          </select>
        </label>
        <p class="fine">客人须用完整链接，或「地址 + 房间号」。禁止仅房间号。</p>
        <div class="gate-box">
          <button type="button" class="primary xl" data-act="start" ${canStart() ? "" : "disabled"}>开始对局</button>
          <p class="hint">${esc(startBlockHint() ?? "可以开局")}</p>
          <button type="button" class="ghost" data-act="probe">重新检测</button>
        </div>
      </aside>`
    : `<aside class="b-invite-pane guest">
        <p class="eyebrow">你已入座</p>
        <h2>${esc(state.guestName)}</h2>
        <label class="field">改名
          <input data-field="guestName" value="${esc(state.guestName)}" />
        </label>
        <button type="button" data-act="claim">占开放座位</button>
        <p class="hint">开局按钮仅主机可见。</p>
      </aside>`;

  return `
    <div class="var-b lobby-b">
      ${left}
      <section class="b-matrix">
        <header><h1>${host ? "座位配置" : "桌上座位"}</h1></header>
        <div class="matrix">${matrix}</div>
      </section>
    </div>
  `;
}

function bDesk() {
  const away = awayCopy();
  const host = state.role === "host";
  const showDrawer =
    host &&
    state.awaySeatId &&
    (state.awayPhase === "away" ||
      state.awayPhase === "timed_out" ||
      state.dispositionOpen);
  return `
    <div class="var-b desk-b">
      <section class="stub-stage">
        <p class="eyebrow">对局 stub</p>
        <div class="stub-table tall">策划桌复用区</div>
        ${
          away
            ? `<div class="away-chip tone-${away.tone}">${esc(away.title)}</div>`
            : ""
        }
      </section>
      <aside class="b-drawer ${showDrawer || away ? "open" : ""}">
        ${
          away
            ? `<h2>${esc(away.title)}</h2><p>${esc(away.body)}</p>
               ${showDrawer ? dispositionButtons() : ""}
               ${state.role === "guest" ? `<button type="button" data-act="reconnect">回席</button>` : ""}`
            : `<h2>连接状态</h2><p class="hint">断线后此处出现等待与主机处置。</p>`
        }
      </aside>
    </div>
  `;
}

/* ========== VARIANT C — 圆桌场 ========== */

function variantC() {
  if (state.scene === "home") return cHome();
  if (state.scene === "join") return cJoin();
  if (state.scene === "lobby") return cLobby();
  return cDesk();
}

function cHome() {
  return `
    <div class="var-c home-c">
      <div class="c-brand">
        <p class="eyebrow">本机 · 局域网</p>
        <h1>政变</h1>
        <p class="tagline">同一张桌，座位可在同网。</p>
      </div>
      <nav class="c-links">
        <button type="button" data-act="local">本机对战</button>
        <button type="button" data-act="create">创建房间</button>
        <button type="button" data-act="join">加入房间</button>
      </nav>
    </div>
  `;
}

function cJoin() {
  return `
    <div class="var-c join-c">
      <button type="button" class="text-back" data-act="scene" data-scene="home">← 入口</button>
      <h1>贴上链接</h1>
      <input class="giant" data-field="joinLink" value="${esc(state.joinLink)}" />
      <details>
        <summary>没有链接？填地址与房间号</summary>
        <div class="field-row">
          <input data-field="joinAddress" value="${esc(state.joinAddress)}" placeholder="IP:端口" />
          <input data-field="joinCode" value="${esc(state.joinCode)}" maxlength="4" placeholder="4821" />
        </div>
      </details>
      <label class="field">显示名
        <input data-field="guestName" value="${esc(state.guestName)}" />
      </label>
      <button type="button" class="primary xl" data-act="submit-join">入座</button>
    </div>
  `;
}

function angleFor(i, n) {
  const start = -90;
  return start + (360 / n) * i;
}

function cLobby() {
  const host = state.role === "host";
  const invite = inviteBits();
  const active = state.seats.filter((s) => s.kind !== "closed");
  // show all 6 around table including closed as dim
  const nodes = state.seats
    .map((s, i) => {
      const ang = angleFor(i, 6);
      const away =
        state.awaySeatId === s.id
          ? ` away-${state.awayPhase}`
          : "";
      return `<button type="button" class="orbit-seat kind-${s.kind}${away}" style="--ang:${ang}deg"
        data-act="${host && s.kind !== "local" ? "cycle-slot" : "noop"}" data-seat="${s.id}">
        <span class="num">${s.id}</span>
        <span class="lab">${
          s.kind === "open"
            ? "开放"
            : s.kind === "closed"
              ? "关"
              : esc(s.name.split("·")[0].trim().slice(0, 6))
        }</span>
      </button>`;
    })
    .join("");

  return `
    <div class="var-c lobby-c">
      <header class="c-lobby-head">
        <div>
          <p class="eyebrow">${host ? "主机大厅" : "已入座"}</p>
          <h1>房间 ${invite.code}</h1>
        </div>
        ${
          host
            ? `<div class="c-invite">
                <code>${esc(invite.url)}</code>
                <button type="button" data-act="copy-link">复制</button>
                <select data-field="selectedNic">${invite.nics
                  .map(
                    (n) =>
                      `<option ${n === state.selectedNic ? "selected" : ""}>${esc(n)}</option>`,
                  )
                  .join("")}</select>
              </div>`
            : `<label class="field compact">名<input data-field="guestName" value="${esc(state.guestName)}" /></label>`
        }
      </header>
      <div class="arena">
        <div class="table-disc">
          <span>${active.length} 席</span>
          ${
            host
              ? `<button type="button" class="primary" data-act="start" ${canStart() ? "" : "disabled"}>开局</button>`
              : `<em>等待主机</em>`
          }
        </div>
        ${nodes}
      </div>
      ${
        host
          ? `<p class="hint center">${esc(
              startBlockHint() ?? "点击非主机座位循环：开放 → Agent → 关闭",
            )}</p>
             <p class="fine center">开放空槽未占满时不能开局；已占远程人类算有效座。</p>`
          : `<p class="hint center">点击演示栏可切主机视角看配置。</p>`
      }
    </div>
  `;
}

function cDesk() {
  const away = awayCopy();
  const host = state.role === "host";
  const seat = state.seats.find((s) => s.id === state.awaySeatId);
  return `
    <div class="var-c desk-c">
      <div class="stub-table">策划桌 stub · 离席座位会「挖空」并在旁出处置筹码</div>
      ${
        away
          ? `<div class="c-away-cluster">
              <div class="hollow-seat tone-${away.tone}">
                <strong>${esc(seat?.name || `座 ${state.awaySeatId}`)}</strong>
                <span>${esc(away.title)}</span>
              </div>
              <p>${esc(away.body)}</p>
              ${
                host &&
                (state.awayPhase === "away" ||
                  state.awayPhase === "timed_out" ||
                  state.dispositionOpen)
                  ? `<div class="chip-ring">${dispositionButtons()}</div>`
                  : state.role === "guest"
                    ? `<button type="button" data-act="reconnect">回席</button>`
                    : ""
              }
            </div>`
          : `<p class="hint center">模拟断线后，离席提示围着空座位出现，而不是顶栏横幅。</p>`
      }
    </div>
  `;
}

/* —— Render / events —— */

function render() {
  const root = document.getElementById("app");
  const body =
    state.variant === "A"
      ? variantA()
      : state.variant === "B"
        ? variantB()
        : variantC();
  root.innerHTML = `${demoBarHtml()}${body}${switcherHtml()}${toastHtml()}`;
}

function cycleVariant(dir) {
  const idx = VARIANTS.findIndex((v) => v.key === state.variant);
  const next = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length];
  setVariant(next.key);
}

function cycleSlot(seatId) {
  if (state.role !== "host") return;
  const seat = state.seats.find((s) => s.id === seatId);
  if (!seat || seat.kind === "local") return;
  const order = ["open", "agent", "closed"];
  // claimed sits in open family → next agent
  const cur =
    seat.kind === "claimed" ? "open" : order.includes(seat.kind) ? seat.kind : "open";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setSlotKind(seatId, next);
}

function onClick(e) {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "prev-variant") cycleVariant(-1);
  else if (act === "next-variant") cycleVariant(1);
  else if (act === "scene") goScene(t.dataset.scene);
  else if (act === "role") {
    state.role = t.dataset.role;
    if (state.role === "guest" && state.scene === "home") state.scene = "join";
    render();
  } else if (act === "local") enterLocal();
  else if (act === "create") createRoom();
  else if (act === "join") openJoin();
  else if (act === "submit-join") submitJoin();
  else if (act === "copy-link") {
    const url = inviteBits().url;
    navigator.clipboard?.writeText(url).catch(() => {});
    toast("已复制加入链接");
  } else if (act === "start") startMatch();
  else if (act === "probe") toast("（原型）已重新探测 CLI / 模型");
  else if (act === "claim") claimAsGuest();
  else if (act === "slot-kind") {
    const kind = t.dataset.kind ?? t.value;
    setSlotKind(Number(t.dataset.seat), kind);
  } else if (act === "cycle-slot") cycleSlot(Number(t.dataset.seat));
  else if (act === "disconnect") simulateDisconnect();
  else if (act === "advance-away") advanceAway();
  else if (act === "reconnect") guestReconnect();
  else if (act === "dispose") dispose(t.dataset.kind);
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.field) {
    state[t.dataset.field] = t.value;
    if (t.dataset.field === "guestName" && state.role === "guest") {
      const mine = state.seats.find((s) => s.kind === "claimed");
      if (mine) mine.name = t.value;
    }
    if (t.dataset.field === "selectedNic") render();
  }
  if (t.dataset.act === "slot-kind") {
    setSlotKind(Number(t.dataset.seat), t.value);
  }
}

function onKey(e) {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable)
    return;
  if (e.key === "ArrowLeft") cycleVariant(-1);
  if (e.key === "ArrowRight") cycleVariant(1);
}

state.variant = readVariant();
document.addEventListener("click", onClick);
document.addEventListener("change", onChange);
document.addEventListener("input", onChange);
document.addEventListener("keydown", onKey);
render();
