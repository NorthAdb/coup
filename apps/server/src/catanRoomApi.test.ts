import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { planAutoDecision } from "@coup/catan-domain";
import { createApp } from "./createApp.js";

/**
 * Catan 房间/对局 API 集成测试：跑在 platform/gameRoomStack + catanModule 之上
 * （ADR-0010）。覆盖：bot 座位配置与自动行动（人类用超时代打推进自己的回合，
 * bot 由服务器驱动交错行动）、座位投影不泄密、人类决策通路、重启恢复。
 */

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "catan-room-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "catan-room-db-"));
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
  const headers = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  for (const header of headers) {
    if (header.startsWith(`${name}=`)) {
      return header.split(";")[0]!;
    }
  }
  return null;
}

type Session = {
  origin: string;
  cookie: string;
  seatCookie: string | null;
  "x-csrf-token": string;
};

async function openSession(
  app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
): Promise<Session> {
  const session = await app.inject({
    method: "GET",
    url: "/api/session",
    headers: { origin },
  });
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

function hostAppOptions(dbPath: string, now?: () => number) {
  return {
    webRoot: undefined as unknown as string,
    dbPath,
    now,
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

type CatanViewLike = {
  seatId: string;
  spectator: boolean;
  game: string;
  stateVersion: number;
  state: {
    matchId: string;
    stateVersion: number;
    status: string;
    players: Array<{
      id: number;
      name: string;
      isHuman: boolean;
      hand: Record<string, number>;
      handCount?: number;
      dev: string[];
      devCount?: number;
    }>;
    devDeck: string[];
    turn: number;
    turnNo: number;
    phase: string;
    robberMoved: boolean;
    pendingTrade: { from: number; to: number } | null;
    lastDice: { a: number; b: number } | null;
    log: Array<{ seq: number; text: string }>;
  };
  hand: Record<string, number>;
  devDeckCount: number;
  decidingSeatId: string | null;
  isYourTurn: boolean;
};

type PollBody = {
  view?: CatanViewLike;
  autoDecision?: { seatId: string; at: number; kind: string } | null;
};

async function poll(app: Awaited<ReturnType<typeof createApp>>, session: Session, code: string): Promise<PollBody> {
  const res = await app.inject({
    method: "GET",
    url: `/api/catan/rooms/${code}/matches/current`,
    headers: { origin: session.origin, cookie: `${session.cookie}; ${session.seatCookie}` },
  });
  assert.equal(res.statusCode, 200);
  return res.json() as PollBody;
}

/**
 * 人类（1 号）用超时代打推进回合；bot 由服务器自动行动。
 * 循环直到 predicate 成立（期间人类与 bot 的决策交错提交）。
 */
async function playUntil(
  app: Awaited<ReturnType<typeof createApp>>,
  session: Session,
  code: string,
  predicate: (body: PollBody) => boolean,
  timeoutMs = 20000,
): Promise<PollBody> {
  const deadline = Date.now() + timeoutMs;
  let last: PollBody | null = null;
  while (Date.now() < deadline) {
    last = await poll(app, session, code);
    if (predicate(last)) return last;
    const view = last.view;
    if (!view) {
      await new Promise((r) => setTimeout(r, 40));
      continue;
    }
    if (view.decidingSeatId === "1") {
      const version = view.state.stateVersion;
      const command = planAutoDecision(view.state as never, 0);
      if (!command) assert.fail("人类超时代打应总有命令可用");
      const decided = await app.inject({
        method: "POST",
        url: `/api/catan/rooms/${code}/matches/current/decision`,
        headers: headersWith(session, session.seatCookie),
        payload: {
          protocolVersion: 1,
          requestId: `auto-${version}`,
          stateVersion: version,
          command,
        },
      });
      if (decided.statusCode !== 200) {
        // 与 bot 决策撞版本等情况：稍后重试。
        await new Promise((r) => setTimeout(r, 60));
      }
    } else {
      await new Promise((r) => setTimeout(r, 40));
    }
  }
  assert.fail(`condition not met in ${timeoutMs}ms; last=${JSON.stringify(last)?.slice(0, 300)}`);
}

async function createRoomWithBots(dbPath: string) {
  const app = await createApp({ ...hostAppOptions(dbPath), webRoot: await tempWebRoot() });
  const origin = "http://192.168.1.42:8787";
  const host = await openSession(app, origin);

  const created = await app.inject({
    method: "POST",
    url: "/api/catan/rooms",
    headers: headersWith(host),
  });
  assert.equal(created.statusCode, 200);
  const invite = created.json() as { code: string; game: string };
  assert.equal(invite.game, "catan");
  host.seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");

  // 配置 2/3/4 号位为 AI。
  for (const seatId of ["2", "3", "4"]) {
    const configured = await app.inject({
      method: "PATCH",
      url: `/api/catan/rooms/${invite.code}/seats/${seatId}/config`,
      headers: headersWith(host, host.seatCookie),
      payload: { kind: "bot" },
    });
    assert.equal(configured.statusCode, 200);
  }
  const room = await app.inject({
    method: "GET",
    url: `/api/catan/rooms/${invite.code}`,
    headers: { origin },
  });
  const seats = (room.json() as { seats: Array<{ seatId: string; kind: string; displayName: string | null }> }).seats;
  assert.deepEqual(
    seats.map((s) => s.kind),
    ["local_human", "bot", "bot", "bot"],
  );
  assert.equal(seats[1]!.displayName, "机器人·甲");

  // bot 座位不可认领。
  const claim = await app.inject({
    method: "POST",
    url: `/api/catan/rooms/${invite.code}/seats/2/claim`,
    headers: headersWith(host),
    payload: { displayName: "小偷" },
  });
  assert.equal(claim.statusCode, 409);

  const started = await app.inject({
    method: "POST",
    url: `/api/catan/rooms/${invite.code}/start`,
    headers: headersWith(host, host.seatCookie),
  });
  assert.equal(started.statusCode, 200);
  const startBody = started.json() as { view: CatanViewLike; phase: string };
  assert.equal(startBody.phase, "match");
  assert.equal(startBody.view.game, "catan");
  assert.equal(startBody.view.state.players.length, 4);
  assert.equal(startBody.view.state.players.filter((p) => p.isHuman).length, 1);
  return { app, host, code: invite.code, startBody };
}

describe("catan room api (platform stack)", () => {
  it("配置 AI 座位开局后机器人自动行动，人类决策通路可用", async () => {
    const { app, host, code } = await createRoomWithBots(await tempDbPath());
    try {
      // 人类用超时代打推进，bot 交错行动；等到某个 bot（2 号）确实行动过。
      const body = await playUntil(app, host, code, (b) => b.autoDecision?.seatId === "2");
      assert.ok(body.autoDecision!.at > 0);
      // 对局日志里应能看到机器人行动。
      const view = await poll(app, host, code);
      assert.ok(
        view.view!.state.log.some((e) => e.text.includes("机器人")),
        "机器人应在对局纪事里留下行动",
      );

      // 人类决策通路：轮到 1 号掷骰阶段时手动掷骰一次。
      const humanTurn = await playUntil(
        app,
        host,
        code,
        (b) => b.view!.decidingSeatId === "1" && b.view!.isYourTurn && b.view!.state.phase === "roll",
      );
      const versionBefore = humanTurn.view!.state.stateVersion;
      const decided = await app.inject({
        method: "POST",
        url: `/api/catan/rooms/${code}/matches/current/decision`,
        headers: headersWith(host, host.seatCookie),
        payload: {
          protocolVersion: 1,
          requestId: `human-${versionBefore}`,
          stateVersion: versionBefore,
          command: { type: "roll", player: 0 },
        },
      });
      assert.equal(decided.statusCode, 200);
      const bodyAfter = decided.json() as { view: CatanViewLike };
      assert.equal(bodyAfter.view.state.stateVersion, versionBefore + 1);
      assert.ok(bodyAfter.view.state.lastDice, "掷骰后应有 lastDice");
    } finally {
      await app.close();
    }
  });

  it("座位投影不泄露他人手牌/发展卡与牌库顺序", async () => {
    const { app, host, code } = await createRoomWithBots(await tempDbPath());
    try {
      // 推进几轮让局面有资源与购买行为。
      await playUntil(app, host, code, (b) => b.autoDecision?.seatId === "3");
      const body = await poll(app, host, code);
      const view = body.view!;
      for (const player of view.state.players) {
        if (player.id === 0) continue;
        const handTotal = Object.values(player.hand).reduce((a, b) => a + b, 0);
        assert.equal(handTotal, 0, "他人手牌必须清零");
        assert.deepEqual(player.dev, [], "他人发展卡必须清空");
      }
      assert.deepEqual(view.state.devDeck, [], "牌库顺序不得下发");
      assert.ok(view.devDeckCount >= 0);
    } finally {
      await app.close();
    }
  });

  it("重启恢复：catan 对局从持久层复原且机器人继续行动", async () => {
    const dbPath = await tempDbPath();
    const first = await createRoomWithBots(dbPath);
    let matchId: string;
    let versionAtClose: number;
    try {
      await playUntil(first.app, first.host, first.code, (b) => b.autoDecision?.seatId === "2");
      const body = await poll(first.app, first.host, first.code);
      matchId = body.view!.state.matchId;
      versionAtClose = body.view!.state.stateVersion;
    } finally {
      await first.app.close();
    }

    const second = await createApp({ ...hostAppOptions(dbPath), webRoot: await tempWebRoot() });
    try {
      const body = await poll(second, first.host, first.code);
      assert.equal(body.view!.state.matchId, matchId);
      assert.ok(
        body.view!.state.stateVersion >= versionAtClose,
        `恢复后版本不回退 restored=${body.view!.state.stateVersion} captured=${versionAtClose}`,
      );
      // 恢复后 bot 继续行动（推进到另一位 bot 行动）。
      await playUntil(second, first.host, first.code, (b) => b.autoDecision?.seatId === "3");
    } finally {
      await second.close();
    }
  });
});
