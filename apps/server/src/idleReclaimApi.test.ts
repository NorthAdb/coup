import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";
import { GRACE_MS } from "./seatAbsence.js";
import { HEARTBEAT_LEASE_MS } from "./seatPresenceTracker.js";
import { IDLE_ROOM_RECLAIM_MS } from "./roomLifecycle.js";

/**
 * 空房回收语义（平台栈）回归：
 * - 大厅/续局阶段房间靠活跃度续命，无人活动 30 分钟后回收；
 * - 对局阶段要求「本地座位（房主浏览器）也不在对局页」+ 全部远程座位离席；
 * - 房主仍在轮询对局时，即使客人都走了也不回收。
 *
 * 修复动机：旧实现里「客人占座后失联的大厅房」与「房主关闭浏览器的对局房」
 * 永不回收，公网部署会永久占满房间上限。
 */

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-reclaim-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-reclaim-db-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function hostAppOptions(now: () => number) {
  return {
    webRoot: undefined as unknown as string,
    dbPath: undefined as unknown as string,
    now,
    hosting: {
      getState: () =>
        ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }) as const,
      ensureHostMode: async () =>
        ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }) as const,
    },
    listNetworkInterfaces: () => ({
      Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
    }),
  };
}

const ORIGIN = "http://192.168.1.42:8787";

function cookieFrom(setCookie: string | string[] | undefined, name: string) {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    if (header.startsWith(`${name}=`)) return header.split(";")[0]!;
  }
  return null;
}

type Session = { origin: string; cookie: string; csrfToken: string };

async function openSession(
  app: Awaited<ReturnType<typeof createApp>>,
): Promise<Session> {
  const response = await app.inject({ method: "GET", url: "/api/session", headers: { origin: ORIGIN } });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { csrfToken: string };
  const cookie = cookieFrom(response.headers["set-cookie"], "coup_session");
  assert.ok(cookie);
  return { origin: ORIGIN, cookie, csrfToken: body.csrfToken };
}

function authHeaders(session: Session, seatCookie?: string | null) {
  return {
    origin: session.origin,
    cookie: seatCookie ? `${session.cookie}; ${seatCookie}` : session.cookie,
    "x-csrf-token": session.csrfToken,
  };
}

async function createRoomWithGuest(
  app: Awaited<ReturnType<typeof createApp>>,
) {
  const host = await openSession(app);
  const created = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: authHeaders(host),
  });
  assert.equal(created.statusCode, 200);
  const { code } = created.json() as { code: string };
  const hostSeat = cookieFrom(created.headers["set-cookie"], "coup_seat");
  assert.ok(hostSeat);

  for (const seatId of ["3", "4", "5", "6"]) {
    const closed: { statusCode: number } = await app.inject({
      method: "PATCH",
      url: `/api/rooms/${code}/seats/${seatId}/config`,
      headers: authHeaders(host, hostSeat),
      payload: { kind: "closed" },
    });
    assert.equal(closed.statusCode, 200);
  }

  const guest = await openSession(app);
  const claimed = await app.inject({
    method: "POST",
    url: `/api/rooms/${code}/seats/2/claim`,
    headers: authHeaders(guest),
    payload: { displayName: "灰狐" },
  });
  assert.equal(claimed.statusCode, 200);
  const guestSeat = cookieFrom(claimed.headers["set-cookie"], "coup_seat");
  assert.ok(guestSeat);
  return { code, host, hostSeat, guest, guestSeat };
}

async function startMatch(
  app: Awaited<ReturnType<typeof createApp>>,
  ctx: Awaited<ReturnType<typeof createRoomWithGuest>>,
) {
  const started = await app.inject({
    method: "POST",
    url: `/api/rooms/${ctx.code}/start`,
    headers: authHeaders(ctx.host, ctx.hostSeat),
  });
  assert.equal(started.statusCode, 200);
}

/** 再建一间新房触发 reclaimIdleRooms（清扫也会在新房创建时运行）。 */
async function triggerSweep(app: Awaited<ReturnType<typeof createApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: authHeaders(await openSession(app)),
  });
  assert.equal(response.statusCode, 200);
}

describe("idle room reclaim", () => {
  it("reclaims a lobby room whose guests are gone, but polling keeps it alive", async () => {
    let clock = 1_000_000;
    const dbPath = await tempDbPath();
    const app = await createApp({ ...hostAppOptions(() => clock), webRoot: await tempWebRoot(), dbPath });
    try {
      const ctx = await createRoomWithGuest(app);

      // 客人还在大厅轮询（GET /rooms/:code）：空置计时不断被刷新，不回收。
      clock += 10 * 60_000;
      const polled = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}`,
        headers: { origin: ORIGIN },
      });
      assert.equal(polled.statusCode, 200);

      clock += 29 * 60_000;
      await triggerSweep(app);
      assert.equal(
        (await app.inject({ method: "GET", url: `/api/rooms/${ctx.code}/presence`, headers: { origin: ORIGIN } })).statusCode,
        200,
      );

      // 最后一次活动之后满 30 分钟无任何请求 → 回收。
      clock += 1 * 60_000 + 1_000;
      await triggerSweep(app);
      assert.equal(
        (await app.inject({ method: "GET", url: `/api/rooms/${ctx.code}/presence`, headers: { origin: ORIGIN } })).statusCode,
        404,
      );
    } finally {
      await app.close();
    }
  });

  it("reclaims a match room after the host browser is gone and guests are absent", async () => {
    let clock = 2_000_000;
    const dbPath = await tempDbPath();
    const app = await createApp({ ...hostAppOptions(() => clock), webRoot: await tempWebRoot(), dbPath });
    try {
      const ctx = await createRoomWithGuest(app);
      await startMatch(app, ctx);

      // 客人报一次心跳后失联，推进到离席。
      const beat = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/heartbeat`,
        headers: authHeaders(ctx.guest, ctx.guestSeat),
      });
      assert.equal(beat.statusCode, 200);
      clock += HEARTBEAT_LEASE_MS + 1;
      clock += GRACE_MS + 1;

      // 房主浏览器从未打开对局页（无本地在场标记）→ 首次观察到空房起算 30 分钟。
      clock += IDLE_ROOM_RECLAIM_MS;
      await triggerSweep(app);
      assert.equal(
        (await app.inject({ method: "GET", url: `/api/rooms/${ctx.code}/presence`, headers: { origin: ORIGIN } })).statusCode,
        200,
        "空房刚被观察到，尚未满 30 分钟",
      );

      clock += IDLE_ROOM_RECLAIM_MS;
      await triggerSweep(app);
      assert.equal(
        (await app.inject({ method: "GET", url: `/api/rooms/${ctx.code}/presence`, headers: { origin: ORIGIN } })).statusCode,
        404,
      );
    } finally {
      await app.close();
    }
  });

  it("keeps a match room alive while the host is still polling the match", async () => {
    let clock = 3_000_000;
    const dbPath = await tempDbPath();
    const app = await createApp({ ...hostAppOptions(() => clock), webRoot: await tempWebRoot(), dbPath });
    try {
      const ctx = await createRoomWithGuest(app);
      await startMatch(app, ctx);

      const beat = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/heartbeat`,
        headers: authHeaders(ctx.guest, ctx.guestSeat),
      });
      assert.equal(beat.statusCode, 200);
      clock += HEARTBEAT_LEASE_MS + 1;
      clock += GRACE_MS + 1;
      clock += IDLE_ROOM_RECLAIM_MS;

      // 房主浏览器仍在轮询对局（GET matches/current 携带本地座位凭证）→ 不回收。
      const polled = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/matches/current`,
        headers: { origin: ORIGIN, cookie: `${ctx.host.cookie}; ${ctx.hostSeat}` },
      });
      assert.equal(polled.statusCode, 200);
      await triggerSweep(app);
      assert.equal(
        (await app.inject({ method: "GET", url: `/api/rooms/${ctx.code}/presence`, headers: { origin: ORIGIN } })).statusCode,
        200,
      );

      // 房主 5 分钟前还在（< 10 分钟本地在场宽限）→ 依旧不回收。
      clock += 5 * 60_000;
      await triggerSweep(app);
      assert.equal(
        (await app.inject({ method: "GET", url: `/api/rooms/${ctx.code}/presence`, headers: { origin: ORIGIN } })).statusCode,
        200,
      );
    } finally {
      await app.close();
    }
  });
});
