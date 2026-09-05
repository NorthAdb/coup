import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { planAutoDecision, type BrassState } from "@coup/brass-domain";
import { createApp } from "./createApp.js";

/**
 * Brass 房间/对局 API 集成测试：跑在 platform/gameRoomStack + brassModule 之上
 * （ADR-0010）。同时锁定两个历史缺陷的回归：
 * 1. 决策逐命令落库（旧 brassRoutes 漏传 persistence，重启后对局回滚到开局）；
 * 2. 续局 join/leave 按座位凭证路由（旧路由与客户端路径不一致，续局无法确认）。
 */

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "brass-room-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "brass-room-db-"));
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
    hosting: {
      getState: () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
      ensureHostMode: async () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
    },
    listNetworkInterfaces: () => ({
      Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
    }),
  };
}

type BrassView = {
  seatId: string;
  spectator: boolean;
  game: string;
  state: BrassState;
  hand: string[];
  decidingSeatId: string | null;
};

async function startTwoPlayerMatch(dbPath: string, now?: () => number) {
  const app = await createApp({ ...hostAppOptions(dbPath, now), webRoot: await tempWebRoot() });
  const hostOrigin = "http://192.168.1.42:8787";
  const host = await openSession(app, hostOrigin);
  const guest = await openSession(app, hostOrigin);

  const created = await app.inject({
    method: "POST",
    url: "/api/brass/rooms",
    headers: headersWith(host),
  });
  assert.equal(created.statusCode, 200);
  const invite = created.json() as { code: string; game: string; phase: string };
  host.seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");

  const claimed = await app.inject({
    method: "POST",
    url: `/api/brass/rooms/${invite.code}/seats/2/claim`,
    headers: headersWith(guest),
    payload: { displayName: "客人乙" },
  });
  assert.equal(claimed.statusCode, 200);
  guest.seatCookie = cookieFrom(claimed.headers["set-cookie"], "coup_seat");

  const started = await app.inject({
    method: "POST",
    url: `/api/brass/rooms/${invite.code}/start`,
    headers: headersWith(host, host.seatCookie),
  });
  assert.equal(started.statusCode, 200);
  const startBody = started.json() as { view: BrassView; matchId: string; phase: string };
  return { app, host, guest, code: invite.code, startBody };
}

/**
 * 以「当前欠决策座位自己的视角」取投影并提交超时代打命令
 * （brass 开局玩家由种子随机，且投影只含本人手牌）。
 */
async function submitAutoCommand(
  app: Awaited<ReturnType<typeof createApp>>,
  code: string,
  players: Array<{ session: Session }>,
): Promise<BrassView> {
  for (const { session } of players) {
    const poll = await app.inject({
      method: "GET",
      url: `/api/brass/rooms/${code}/matches/current`,
      headers: { origin: session.origin, cookie: `${session.cookie}; ${session.seatCookie}` },
    });
    assert.equal(poll.statusCode, 200);
    const view = (poll.json() as { view: BrassView }).view;
    if (view.decidingSeatId !== view.seatId) continue;
    const player = Number(view.seatId) - 1;
    const command = planAutoDecision(view.state, player, view.state.stateVersion);
    assert.ok(command, "deciding seat must have an auto-plan command");
    const decided = await app.inject({
      method: "POST",
      url: `/api/brass/rooms/${code}/matches/current/decision`,
      headers: headersWith(session, session.seatCookie),
      payload: {
        protocolVersion: 1,
        requestId: `auto-${view.state.stateVersion}`,
        stateVersion: view.state.stateVersion,
        command,
      },
    });
    assert.equal(decided.statusCode, 200);
    return (decided.json() as { view: BrassView }).view;
  }
  assert.fail("no deciding seat found among sessions");
}

describe("brass room api (platform stack)", () => {
  it("creates a brass room, starts a match and commits a legal command", async () => {
    const { app, host, guest, code, startBody } = await startTwoPlayerMatch(await tempDbPath());
    try {
      assert.equal(startBody.phase, "match");
      assert.equal(startBody.view.game, "brass");
      assert.equal(startBody.view.seatId, "1");
      assert.ok(["1", "2"].includes(startBody.view.decidingSeatId ?? ""));

      const before = startBody.view.state.stateVersion;
      const view = await submitAutoCommand(app, code, [
        { session: host },
        { session: guest },
      ]);
      assert.equal(view.state.stateVersion, before + 1);

      // 增量轮询：状态未变时轻量返回。
      const unchanged = await app.inject({
        method: "GET",
        url: `/api/brass/rooms/${code}/matches/current?since=${view.state.stateVersion}`,
        headers: { origin: host.origin, cookie: `${host.cookie}; ${host.seatCookie}` },
      });
      assert.equal(unchanged.statusCode, 200);
      assert.equal((unchanged.json() as { unchanged: boolean }).unchanged, true);
    } finally {
      await app.close();
    }
  });

  it("serves read-only spectators without seat credentials", async () => {
    const { app, host, code } = await startTwoPlayerMatch(await tempDbPath());
    try {
      const spectate = await app.inject({
        method: "GET",
        url: `/api/brass/rooms/${code}/matches/current?spectate=1`,
        headers: { origin: host.origin },
      });
      assert.equal(spectate.statusCode, 200);
      const body = spectate.json() as { view: BrassView };
      assert.equal(body.view.spectator, true);
      assert.deepEqual(body.view.hand, []);
    } finally {
      await app.close();
    }
  });

  it("keeps committed commands across a host restart (persistence regression)", async () => {
    const dbPath = await tempDbPath();
    const first = await startTwoPlayerMatch(dbPath);
    let stateVersion: number;
    try {
      const view = await submitAutoCommand(first.app, first.code, [
        { session: first.host },
        { session: first.guest },
      ]);
      stateVersion = view.state.stateVersion;
    } finally {
      await first.app.close();
    }

    // 重启：房间逐房恢复 + 对局恢复到已提交的最新状态（而非开局初始态）。
    const second = await createApp({ ...hostAppOptions(dbPath), webRoot: await tempWebRoot() });
    try {
      const recovery = await second.inject({
        method: "GET",
        url: "/api/brass/room-recovery",
        headers: { origin: "http://192.168.1.42:8787" },
      });
      assert.equal(recovery.statusCode, 200);
      const items = (recovery.json() as { items: Array<{ code: string; status: string; game: string; phase: string }> }).items;
      const restored = items.find((item) => item.code === first.code);
      assert.ok(restored);
      assert.equal(restored.status, "restored");
      assert.equal(restored.game, "brass");
      assert.equal(restored.phase, "match");

      const spectate = await second.inject({
        method: "GET",
        url: `/api/brass/rooms/${first.code}/matches/current?spectate=1`,
        headers: { origin: "http://192.168.1.42:8787" },
      });
      assert.equal(spectate.statusCode, 200);
      const view = (spectate.json() as { view: BrassView }).view;
      assert.equal(view.state.stateVersion, stateVersion);
      assert.equal(view.state.status, "in_progress");
    } finally {
      await second.close();
    }
  });

  it("routes rematch endpoints by seat credential and gates on match phase", async () => {
    const { app, host, guest, code } = await startTwoPlayerMatch(await tempDbPath());
    try {
      const early = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/rematch`,
        headers: headersWith(host, host.seatCookie),
      });
      assert.equal(early.statusCode, 409);
      assert.equal((early.json() as { error: string }).error, "match_in_progress");

      // 回归：/rematch/join 必须按座位凭证解析座位（旧实现与客户端路径不一致）。
      const join = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/rematch/join`,
        headers: headersWith(guest, guest.seatCookie),
      });
      assert.equal(join.statusCode, 409);
      assert.equal((join.json() as { error: string }).error, "room_not_rematch");

      const leave = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/rematch/leave`,
        headers: headersWith(guest, guest.seatCookie),
      });
      assert.equal(leave.statusCode, 409);
      assert.equal((leave.json() as { error: string }).error, "room_not_rematch");
    } finally {
      await app.close();
    }
  });

  it("rejects non-contiguous lobby seats on start", async () => {
    const dbPath = await tempDbPath();
    const app = await createApp({ ...hostAppOptions(dbPath), webRoot: await tempWebRoot() });
    const origin = "http://192.168.1.42:8787";
    try {
      const host = await openSession(app, origin);
      const guest = await openSession(app, origin);
      const created = await app.inject({
        method: "POST",
        url: "/api/brass/rooms",
        headers: headersWith(host),
      });
      const code = (created.json() as { code: string }).code;
      host.seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");

      // 房主先关闭 2 号，再让客人占 3 号 → 有效座位非连续。
      const closed = await app.inject({
        method: "PATCH",
        url: `/api/brass/rooms/${code}/seats/2/config`,
        headers: headersWith(host, host.seatCookie),
        payload: { kind: "closed" },
      });
      assert.equal(closed.statusCode, 200);
      const claimed = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/seats/3/claim`,
        headers: headersWith(guest),
        payload: { displayName: "客人乙" },
      });
      assert.equal(claimed.statusCode, 200);

      const started = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/start`,
        headers: headersWith(host, host.seatCookie),
      });
      assert.equal(started.statusCode, 400);
      assert.equal((started.json() as { error: string }).error, "seats_not_contiguous");
    } finally {
      await app.close();
    }
  });

  it("keeps brass disposition semantics (no forced elimination)", async () => {
    let clock = 1_000_000;
    const dbPath = await tempDbPath();
    const { app, host, code } = await startTwoPlayerMatch(dbPath, () => clock);
    try {
      // 越过 4s 心跳租约 + 15s 重连宽限，让 2 号座位进入离席。
      clock += 20_000;
      const presence = await app.inject({
        method: "GET",
        url: `/api/brass/rooms/${code}/presence`,
        headers: { origin: host.origin },
      });
      assert.equal(presence.statusCode, 200);
      const absences = (presence.json() as { absences: Array<{ seatId: string; phase: string }> }).absences;
      const guest = absences.find((absence) => absence.seatId === "2");
      assert.ok(guest);
      assert.equal(guest.phase, "absent");

      const eliminated = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/seats/2/disposition`,
        headers: headersWith(host, host.seatCookie),
        payload: { action: "force_eliminate" },
      });
      assert.equal(eliminated.statusCode, 400);
      assert.equal((eliminated.json() as { error: string }).error, "disposition_not_supported");

      const extended = await app.inject({
        method: "POST",
        url: `/api/brass/rooms/${code}/seats/2/disposition`,
        headers: headersWith(host, host.seatCookie),
        payload: { action: "extend_wait" },
      });
      assert.equal(extended.statusCode, 200);
    } finally {
      await app.close();
    }
  });

  it("does not throttle unknown brass room lookups", async () => {
    const dbPath = await tempDbPath();
    const app = await createApp({ ...hostAppOptions(dbPath), webRoot: await tempWebRoot() });
    try {
      for (let i = 0; i < 12; i += 1) {
        const miss = await app.inject({
          method: "GET",
          url: "/api/brass/rooms/9999",
          headers: { origin: "http://192.168.1.42:8787" },
        });
        assert.equal(miss.statusCode, 404);
      }
    } finally {
      await app.close();
    }
  });
});
