import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { planAutoDecision as planBrassAuto } from "@coup/brass-domain";
import { planAutoDecision as planSplendorAuto } from "@coup/splendor-domain";
import { createApp } from "./createApp.js";

/**
 * AI 队友（bot 座位）平台级集成测试：brass / splendor / coup 各开一局
 * 「房主 + bot」，人类用超时代打推进自己的回合，验证服务器机器人自动决策
 * 且对局状态持续推进（bot 行动以平台 autoDecision 标记精确断言）。
 */

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "bot-seat-"));
  tempDirs.push(webRoot);
  await writeFile(path.join(webRoot, "index.html"), "<!doctype html><html><body>ok</body></html>");
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "bot-seat-db-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function cookieFrom(setCookie: string | string[] | undefined, name: string) {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    if (header.startsWith(`${name}=`)) return header.split(";")[0]!;
  }
  return null;
}

type Session = { origin: string; cookie: string; seatCookie: string | null; "x-csrf-token": string };

async function openSession(app: Awaited<ReturnType<typeof createApp>>, origin: string): Promise<Session> {
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { origin } });
  assert.equal(session.statusCode, 200);
  const csrfToken = (session.json() as { csrfToken: string }).csrfToken;
  const cookie = cookieFrom(session.headers["set-cookie"], "coup_session");
  assert.ok(cookie);
  return { origin, cookie, seatCookie: null, "x-csrf-token": csrfToken };
}

function headersWith(session: Session, seatCookie?: string | null) {
  return {
    origin: session.origin,
    cookie: seatCookie ? `${session.cookie}; ${seatCookie}` : session.cookie,
    "x-csrf-token": session["x-csrf-token"],
  };
}

function hostAppOptions(dbPath: string) {
  return {
    webRoot: undefined as unknown as string,
    dbPath,
    botDecisionDelayMs: () => 5,
    hosting: {
      getState: () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
      ensureHostMode: async () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
    },
    listNetworkInterfaces: () => ({
      Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
    }),
  };
}

type AnyView = {
  stateVersion: number;
  state: Record<string, unknown> & { seats?: Array<{ controller: string }>; botPlayers?: number[] };
  decidingSeatId: string | null;
  /** coup 视图形状。 */
  publicState?: { stateVersion: number; phase: string; currentSeatId: string; activeSeatId: string | null; seats: Array<{ controller: string }> };
  legalDecisions?: Array<{ type: string }>;
};

type PollBody = {
  view?: AnyView;
  autoDecision?: { seatId: string; at: number; kind: string } | null;
};

/** coup 投影只有 legalDecisions：按超时代打同款优先级挑一条。 */
function planCoupChoice(view: AnyView): { type: string } | null {
  const legal = view.legalDecisions ?? [];
  const pick = (type: string) => legal.find((d) => d.type === type);
  return (
    pick("pass_block") ??
    pick("pass_challenge") ??
    pick("concede_claim") ??
    pick("choose_influence_to_reveal") ??
    pick("choose_exchange_cards") ??
    legal.find((d) => d.type === "declare_action" && (d as { action?: { type: string } }).action?.type === "income") ??
    legal[0] ??
    null
  );
}

function baseOf(prefix: "" | "brass" | "splendor"): string {
  return prefix ? `/api/${prefix}` : "/api";
}

async function poll(app: Awaited<ReturnType<typeof createApp>>, host: Session, code: string, prefix: "" | "brass" | "splendor"): Promise<PollBody> {
  const pollRes = await app.inject({
    method: "GET",
    url: `${baseOf(prefix)}/rooms/${code}/matches/current`,
    headers: { origin: host.origin, cookie: `${host.cookie}; ${host.seatCookie}` },
  });
  assert.equal(pollRes.statusCode, 200);
  return pollRes.json() as PollBody;
}

/** 人类（房主）用超时代打推进；bot 由服务器自动驱动。直到 predicate 成立。 */
async function playUntil(
  app: Awaited<ReturnType<typeof createApp>>,
  host: Session,
  code: string,
  prefix: "" | "brass" | "splendor",
  predicate: (body: PollBody) => boolean,
  timeoutMs = 15000,
): Promise<PollBody> {
  const deadline = Date.now() + timeoutMs;
  let last: PollBody | null = null;
  while (Date.now() < deadline) {
    last = await poll(app, host, code, prefix);
    if (predicate(last)) return last;
    const view = last.view;
    if (!view) {
      await new Promise((r) => setTimeout(r, 40));
      continue;
    }
    // coup 的视图是 publicState/legalDecisions 形状：1 号有合法决策即欠决策。
    const coupOwes =
      prefix === "" &&
      (view.legalDecisions?.length ?? 0) > 0 &&
      (view.publicState?.activeSeatId === "1" ||
        (view.publicState?.phase === "await_action" && view.publicState?.currentSeatId === "1"));
    if (view.decidingSeatId === "1" || coupOwes) {
      const version = prefix === "" ? view.publicState!.stateVersion : view.stateVersion;
      const payload =
        prefix === "brass"
          ? {
              protocolVersion: 1,
              requestId: `auto-${version}`,
              stateVersion: version,
              command: planBrassAuto(view.state as never, 0, version),
            }
          : prefix === "splendor"
            ? {
                protocolVersion: 1,
                requestId: `auto-${version}`,
                stateVersion: version,
                command: planSplendorAuto(view.state as never, 0, version),
              }
            : {
                protocolVersion: 1,
                requestId: `auto-${version}`,
                stateVersion: version,
                decision: planCoupChoice(view),
              };
      const decided = await app.inject({
        method: "POST",
        url: `${baseOf(prefix)}/rooms/${code}/matches/current/decision`,
        headers: headersWith(host, host.seatCookie),
        payload,
      });
      if (decided.statusCode !== 200) {
        // 可能与 bot 决策撞版本：稍后重试。
        await new Promise((r) => setTimeout(r, 60));
      }
    } else {
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  assert.fail(`condition not met in ${timeoutMs}ms; last=${JSON.stringify(last)?.slice(0, 300)}`);
}

describe("bot seats (AI teammates)", () => {
  it("brass：bot 座位自动建造/铺路，状态持续推进", async () => {
    const app = await createApp({ ...hostAppOptions(await tempDbPath()), webRoot: await tempWebRoot() });
    try {
      const origin = "http://192.168.1.42:8787";
      const host = await openSession(app, origin);
      const created = await app.inject({ method: "POST", url: "/api/brass/rooms", headers: headersWith(host) });
      assert.equal(created.statusCode, 200);
      const { code } = created.json() as { code: string };
      host.seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");
      const configured = await app.inject({
        method: "PATCH",
        url: `/api/brass/rooms/${code}/seats/2/config`,
        headers: headersWith(host, host.seatCookie),
        payload: { kind: "bot" },
      });
      assert.equal(configured.statusCode, 200);
      const started = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/start`,
        headers: headersWith(host, host.seatCookie),
      });
      assert.equal(started.statusCode, 200);

      const body = await playUntil(app, host, code, "brass", (b) => b.autoDecision?.seatId === "2");
      assert.ok(body.autoDecision!.at > 0);
      const state = body.view!.state as { botPlayers?: number[] };
      assert.deepEqual(state.botPlayers, [1]);
    } finally {
      await app.close();
    }
  });

  it("splendor：bot 座位自动拿宝石/购卡，状态持续推进", async () => {
    const app = await createApp({ ...hostAppOptions(await tempDbPath()), webRoot: await tempWebRoot() });
    try {
      const origin = "http://192.168.1.42:8787";
      const host = await openSession(app, origin);
      const created = await app.inject({ method: "POST", url: "/api/splendor/rooms", headers: headersWith(host) });
      assert.equal(created.statusCode, 200);
      const { code } = created.json() as { code: string };
      host.seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");
      const configured = await app.inject({
        method: "PATCH",
        url: `/api/splendor/rooms/${code}/seats/2/config`,
        headers: headersWith(host, host.seatCookie),
        payload: { kind: "bot" },
      });
      assert.equal(configured.statusCode, 200);
      const started = await app.inject({
        method: "POST",
        url: `/api/splendor/rooms/${code}/start`,
        headers: headersWith(host, host.seatCookie),
      });
      assert.equal(started.statusCode, 200);

      const body = await playUntil(app, host, code, "splendor", (b) => b.autoDecision?.seatId === "2");
      const state = body.view!.state as { botPlayers?: number[] };
      assert.deepEqual(state.botPlayers, [1]);
    } finally {
      await app.close();
    }
  });

  it("coup：bot 座位（stub_agent）自动声明行动", async () => {
    const app = await createApp({ ...hostAppOptions(await tempDbPath()), webRoot: await tempWebRoot() });
    try {
      const origin = "http://192.168.1.42:8787";
      const host = await openSession(app, origin);
      const created = await app.inject({ method: "POST", url: "/api/rooms", headers: headersWith(host) });
      assert.equal(created.statusCode, 200);
      const { code } = created.json() as { code: string };
      host.seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");
      const configured = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${code}/seats/2/config`,
        headers: headersWith(host, host.seatCookie),
        payload: { kind: "bot" },
      });
      assert.equal(configured.statusCode, 200);
      // coup 共 6 座：其余空位关闭才能满足开局门禁。
      for (const seatId of ["3", "4", "5", "6"]) {
        const closed = await app.inject({
          method: "PATCH",
          url: `/api/rooms/${code}/seats/${seatId}/config`,
          headers: headersWith(host, host.seatCookie),
          payload: { kind: "closed" },
        });
        assert.equal(closed.statusCode, 200);
      }
      const started = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/start`,
        headers: headersWith(host, host.seatCookie),
      });
      assert.equal(started.statusCode, 200);

      const body = await playUntil(app, host, code, "", (b) => b.autoDecision?.seatId === "2");
      const seats = body.view!.publicState!.seats;
      assert.equal(seats[1]!.controller, "stub_agent");
      assert.ok(body.autoDecision!.kind.length > 0);
    } finally {
      await app.close();
    }
  });
});
