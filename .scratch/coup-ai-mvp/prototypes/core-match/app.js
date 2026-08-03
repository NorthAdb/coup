// PROTOTYPE — three core-match UI variants, switchable with ?variant=A|B|C.
const variants = {
  A: { name: "舞台聚焦", note: "对照：上方座位横排 + 右侧对局记录" },
  B: { name: "策划桌", note: "选定：左侧座位、中央舞台、右侧对局记录、规则入口" },
  C: { name: "电影焦点", note: "对照：压缩桌面信息，放大当前声明" },
};

const opponents = [
  { id: "s2", name: "灰狐", model: "Claude · Sonnet", coins: 3, status: "等待响应", cards: 2 },
  { id: "s3", name: "白塔", model: "OpenCode · GPT", coins: 5, status: "观察中", cards: 2 },
  { id: "s4", name: "夜莺", model: "Claude · Opus", coins: 2, status: "观察中", cards: 1, revealed: true },
  { id: "s5", name: "黑帆", model: "OpenCode · Qwen", coins: 7, status: "观察中", cards: 2 },
  { id: "s6", name: "赤鹿", model: "Claude · Sonnet", coins: 4, status: "观察中", cards: 2 },
];

const actionDefinitions = [
  { id: "income", label: "收入", hint: "+1", target: false },
  { id: "foreign_aid", label: "外援", hint: "+2", target: false },
  { id: "coup", label: "政变", hint: "7 金币", target: true },
  { id: "tax", label: "征税", hint: "公爵 · +3", target: false },
  { id: "assassinate", label: "刺杀", hint: "刺客 · 3", target: true },
  { id: "steal", label: "偷窃", hint: "队长 · 目标", target: true },
  { id: "exchange", label: "交换", hint: "大使", target: false },
];

const state = {
  variant: readVariant(),
  fast: false,
  phase: "response",
  activeSeat: "s2",
  targetSelection: null,
  stageTitle: "灰狐声称拥有队长",
  stageText: "灰狐尝试从你这里偷取 2 枚钱币。按顺时针顺序，现在轮到你响应。",
  claim: "偷窃 · 队长",
  events: [
    "第 4 回合开始，轮到灰狐。",
    "灰狐声明偷窃，目标是你。",
    "无人质疑行动声明。",
    "你可以声明阻挡或放弃。",
  ],
  reveal: null,
  rulesOpen: false,
};

function readVariant() {
  const value = new URLSearchParams(location.search).get("variant")?.toUpperCase();
  return variants[value] ? value : "B";
}

function seatCard(seat) {
  const cards = Array.from({ length: seat.cards }, (_, index) => {
    const revealed = seat.revealed && index === seat.cards - 1 ? " revealed" : "";
    return `<span class="mini-card${revealed}"></span>`;
  }).join("");

  const targetable = state.targetSelection ? " targetable" : "";
  const active = state.activeSeat === seat.id ? " active" : "";
  return `
    <article class="seat${active}${targetable}" data-seat="${seat.id}">
      <div class="seat-header">
        <span class="seat-name">${seat.name}</span>
        <span class="coin">${seat.coins}</span>
      </div>
      <div class="mini-cards">${cards}</div>
      <div class="seat-meta">
        <span class="model-name">${seat.model}</span>
        <span class="seat-status">${seat.status}</span>
      </div>
    </article>
  `;
}

function opponentsView() {
  return `<section class="opponents">${opponents.map(seatCard).join("")}</section>`;
}

function responseBar() {
  if (state.phase !== "response") return "";
  return `
    <div class="response-bar">
      <span>轮到你响应</span>
      <button class="response-button primary" data-response="challenge">质疑</button>
      <button class="response-button" data-response="block">阻挡</button>
      <button class="response-button" data-response="pass">放弃</button>
    </div>
  `;
}

function stageView(includeStrip = false) {
  return `
    <section class="stage">
      <div class="stage-card">
        <div class="eyebrow">${state.phase === "target" ? "选择目标" : "当前行动"}</div>
        <h2>${state.stageTitle}</h2>
        <p>${state.stageText}</p>
        ${state.claim ? `<div class="claim-token entering"><span>角色声明</span><strong>${state.claim}</strong></div>` : ""}
        ${responseBar()}
      </div>
      ${includeStrip ? `<div class="event-strip">${state.events.at(-1)}</div>` : ""}
    </section>
  `;
}

function handView() {
  return `
    <div class="hand">
      <article class="role-card" style="--role: rgba(82, 116, 153, .62)">
        <div class="role-icon">♜</div>
        <span class="role-name">公爵</span>
        <span class="role-action">征税 · 阻挡外援</span>
      </article>
      <article class="role-card" style="--role: rgba(112, 83, 133, .64)">
        <div class="role-icon">♞</div>
        <span class="role-name">伯爵夫人</span>
        <span class="role-action">阻挡刺杀</span>
      </article>
    </div>
  `;
}

function actionsView() {
  return `
    <div class="action-zone">
      <div class="action-label">
        <span>${state.phase === "response" ? "请先处理响应" : "选择一个合法行动"}</span>
        <span>你的金币：4</span>
      </div>
      <div class="action-bar">
        ${actionDefinitions.map(action => `
          <button class="action-button" data-action="${action.id}" ${state.phase === "response" ? "disabled" : ""}>
            ${action.label}<small>${action.hint}</small>
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function playerZone() {
  return `<section class="player-zone">${handView()}${actionsView()}</section>`;
}

function eventRail() {
  return `
    <aside class="event-rail">
      <div class="rail-title"><span>对局记录</span><span>第 4 回合</span></div>
      <ol class="event-list">
        ${state.events.map(event => `<li class="event">${event}</li>`).join("")}
      </ol>
      <details class="state-view">
        <summary>PROTOTYPE STATE</summary>
        <pre>${escapeHtml(JSON.stringify(state, null, 2))}</pre>
      </details>
    </aside>
  `;
}

function boardA() {
  return `<main class="board variant-a">${opponentsView()}${stageView()}${playerZone()}${eventRail()}</main>`;
}

function boardB() {
  return `
    <main class="board variant-b">
      ${opponentsView()}
      <div class="main-column">
        ${stageView()}
        ${playerZone()}
      </div>
      ${eventRail()}
    </main>
  `;
}

function rulesOverlay() {
  if (!state.rulesOpen) return "";
  return `
    <div class="rules-overlay">
      <div class="rules-panel" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <header class="rules-header">
          <div>
            <p class="eyebrow">基础版</p>
            <h2 id="rules-title">游戏规则</h2>
          </div>
          <button class="quiet-button" data-close-rules type="button">关闭</button>
        </header>
        <div class="rules-body">
          <section>
            <h3>目标</h3>
            <p>成为最后一个仍有影响力的玩家。影响力是你面前仍面朝下的角色牌；两张都翻开后淘汰。</p>
          </section>
          <section>
            <h3>设置</h3>
            <p>2–6 人。洗混 15 张角色牌，每人发 2 张，余下为宫廷牌库。每人通常拿 2 枚钱币；2 人局先手拿 1 枚。</p>
          </section>
          <section>
            <h3>一般行动</h3>
            <ul>
              <li><strong>收入</strong>：+1 钱币。不可质疑，不可阻挡。</li>
              <li><strong>外援</strong>：尝试 +2 钱币。不可质疑；可用公爵阻挡。</li>
              <li><strong>政变</strong>：支付 7，目标失去 1 点影响力。必定成功。10 枚及以上时本回合必须政变。</li>
            </ul>
          </section>
          <section>
            <h3>角色行动</h3>
            <ul>
              <li><strong>公爵 · 征税</strong>：+3。可质疑，不可阻挡。</li>
              <li><strong>刺客 · 刺杀</strong>：支付 3，目标失去影响力。可质疑；目标可用伯爵夫人阻挡。</li>
              <li><strong>队长 · 偷窃</strong>：从目标拿最多 2。可质疑；目标可用大使或队长阻挡。</li>
              <li><strong>大使 · 交换</strong>：抽 2 张，与自己的面朝下牌合并后归还 2 张并洗牌。可质疑，不可阻挡。</li>
            </ul>
          </section>
          <section>
            <h3>响应顺序</h3>
            <p>声明行动（含目标）→ 质疑行动 → 声明阻挡 → 质疑阻挡 → 结算。按顺时针逐席响应，第一个有效响应生效。</p>
          </section>
          <section>
            <h3>质疑</h3>
            <p>被质疑者可证明角色（展示后洗回并抽替代牌，质疑者失去影响力），也可认输并失去自己的影响力。阻挡被揭穿后不重开阻挡窗口。</p>
          </section>
        </div>
      </div>
    </div>
  `;
}

function boardC() {
  return `<main class="board variant-c">${opponentsView()}${stageView(true)}${playerZone()}</main>`;
}

function switcher() {
  const meta = variants[state.variant];
  return `
    <nav class="prototype-switcher" aria-label="原型变体">
      <button class="switch-arrow" data-switch="-1" aria-label="上一个变体">←</button>
      <div class="switch-label">
        <strong>${state.variant} — ${meta.name}</strong>
        <span>${meta.note}</span>
      </div>
      <button class="switch-arrow" data-switch="1" aria-label="下一个变体">→</button>
    </nav>
  `;
}

function revealOverlay() {
  if (!state.reveal) return "";
  return `
    <div class="reveal-overlay">
      <div class="reveal-card">
        <div class="role-icon">♟</div>
        <strong>${state.reveal}</strong>
        <p>证明角色</p>
      </div>
    </div>
  `;
}

function render() {
  document.documentElement.style.setProperty("--speed", state.fast ? "0.45" : "1");
  const boards = { A: boardA, B: boardB, C: boardC };
  document.querySelector("#app").innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <span class="prototype-badge">THROWAWAY PROTOTYPE</span>
          <h1>政变</h1>
          <span class="round-badge">第 4 回合</span>
        </div>
        <div class="top-actions">
          <button class="quiet-button" data-rules type="button">规则介绍</button>
          <button class="speed-button" data-speed type="button">${state.fast ? "快速模式" : "平衡节奏"}</button>
          <button class="quiet-button" data-reset type="button">重置演示</button>
        </div>
      </header>
      ${boards[state.variant]()}
      ${switcher()}
      ${revealOverlay()}
      ${rulesOverlay()}
    </div>
  `;
  scrollEvents();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function scrollEvents() {
  const list = document.querySelector(".event-list");
  if (list) list.scrollTop = list.scrollHeight;
}

function addEvent(text) {
  state.events.push(text);
}

function chooseAction(actionId) {
  const action = actionDefinitions.find(item => item.id === actionId);
  if (!action) return;
  if (action.target) {
    state.targetSelection = action;
    state.phase = "target";
    state.stageTitle = `为“${action.label}”选择目标`;
    state.stageText = "可选择的对手座位已高亮。选择目标前不会提交行动。";
    state.claim = action.hint.includes("·") ? action.hint : null;
  } else {
    state.targetSelection = null;
    state.phase = "idle";
    state.stageTitle = `你声明了“${action.label}”`;
    state.stageText = "行动进入权威状态机，等待其他座位按顺时针响应。";
    state.claim = action.hint.includes("·") ? action.hint : null;
    addEvent(`<strong>你</strong>声明${action.label}。`);
  }
  render();
}

function chooseTarget(seatId) {
  if (!state.targetSelection) return;
  const seat = opponents.find(item => item.id === seatId);
  const action = state.targetSelection;
  state.targetSelection = null;
  state.phase = "idle";
  state.activeSeat = "s1";
  state.stageTitle = `你对${seat.name}声明“${action.label}”`;
  state.stageText = "目标和行动同时提交。下一步将按顺时针开启质疑窗口。";
  state.claim = action.hint.includes("·") ? action.hint : null;
  addEvent(`<strong>你</strong>对${seat.name}声明${action.label}。`);
  render();
}

function handleResponse(kind) {
  if (kind === "challenge") {
    addEvent("<strong>你</strong>质疑灰狐的队长声明。");
    state.phase = "reveal";
    state.stageTitle = "质疑成立，等待灰狐证明";
    state.stageText = "牌面将短暂进入中央焦点，其他桌面信息保持原位。";
    state.reveal = "队长";
    render();
    window.setTimeout(() => {
      state.reveal = null;
      state.stageTitle = "灰狐证明了队长";
      state.stageText = "队长洗回宫廷牌库，灰狐抽取一张未知替代牌。你将失去一点影响力。";
      state.claim = "证明成功 · 正在补牌";
      addEvent("灰狐亮出队长并完成换牌。");
      render();
      window.setTimeout(() => {
        state.phase = "idle";
        state.claim = null;
        state.stageTitle = "选择要揭示的影响力";
        state.stageText = "真实产品中两张手牌会进入可选择状态；本原型只验证亮牌与补牌节奏。";
        addEvent("系统等待你选择失去哪一点影响力。");
        render();
      }, state.fast ? 330 : 760);
    }, state.fast ? 420 : 980);
    return;
  }

  state.phase = "idle";
  state.activeSeat = "s1";
  state.claim = null;
  if (kind === "block") {
    state.stageTitle = "你声称拥有大使";
    state.stageText = "阻挡声明进入中央舞台，接下来按顺时针询问是否质疑。";
    addEvent("<strong>你</strong>声称大使，阻挡偷窃。");
  } else {
    state.stageTitle = "你放弃响应";
    state.stageText = "响应条平滑收起，行动继续结算。";
    addEvent("<strong>你</strong>放弃阻挡。");
  }
  render();
}

function resetDemo() {
  Object.assign(state, {
    phase: "response",
    activeSeat: "s2",
    targetSelection: null,
    stageTitle: "灰狐声称拥有队长",
    stageText: "灰狐尝试从你这里偷取 2 枚钱币。按顺时针顺序，现在轮到你响应。",
    claim: "偷窃 · 队长",
    events: [
      "第 4 回合开始，轮到灰狐。",
      "灰狐声明偷窃，目标是你。",
      "无人质疑行动声明。",
      "你可以声明阻挡或放弃。",
    ],
    reveal: null,
    rulesOpen: false,
  });
  render();
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  const params = new URLSearchParams(location.search);
  params.set("variant", state.variant);
  history.replaceState(null, "", `${location.pathname}?${params}`);
  render();
}

document.addEventListener("click", event => {
  const switchButton = event.target.closest("[data-switch]");
  if (switchButton) return cycleVariant(Number(switchButton.dataset.switch));

  if (event.target.closest("[data-speed]")) {
    state.fast = !state.fast;
    return render();
  }

  if (event.target.closest("[data-reset]")) return resetDemo();

  if (event.target.closest("[data-rules]")) {
    state.rulesOpen = true;
    return render();
  }

  if (event.target.closest("[data-close-rules]") || event.target.classList.contains("rules-overlay")) {
    state.rulesOpen = false;
    return render();
  }

  const response = event.target.closest("[data-response]");
  if (response) return handleResponse(response.dataset.response);

  const action = event.target.closest("[data-action]");
  if (action && !action.disabled) return chooseAction(action.dataset.action);

  const seat = event.target.closest("[data-seat]");
  if (seat) return chooseTarget(seat.dataset.seat);
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && state.rulesOpen) {
    state.rulesOpen = false;
    return render();
  }
  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA"].includes(tag) || document.activeElement?.isContentEditable) return;
  if (state.rulesOpen) return;
  if (event.key === "ArrowLeft") cycleVariant(-1);
  if (event.key === "ArrowRight") cycleVariant(1);
});

render();
