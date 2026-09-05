import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";

/**
 * 客人主动让座（平台栈端点 `POST …/rooms/:code/seats/leave`）与
 * 座位凭证 Cookie 持久化（Max-Age）的回归。
 * 让座语义：仅大厅阶段、仅远程客人自己；让出后座位转开放、凭证作废，
 * 他人可立即入座。对局中的离开走离席/房主处置，不在本端点范围内。
 */

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-leave-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-leave-db-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const ORIGIN = "http://192.168.1.42:8787";

function hostAppOptions() {
  return {
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

function cookieFrom(setCookie: string | string[] | undefined, name: string) {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    if (header.startsWith(`${name}=`)) return header.split(";")[0]!;
  }
  return null;
}

type Session = { origin: string; cookie: string; csrfToken: string };

async function openSession(app: Awaited<ReturnType<typeof createApp>>) {
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

/** 建房 + 占 2 号座；返回 host/guest 会话与各自座位凭证 Cookie。 */
async function createLobbyWithGuest(app: Awaited<ReturnType<typeof createApp>>) {
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

describe("guest lobby seat leave", () => {
  it("releases the seat, voids the credential, and the seat becomes claimable again", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });
    try {
      const ctx = await createLobbyWithGuest(app);

      const left = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/leave`,
        headers: authHeaders(ctx.guest, ctx.guestSeat),
      });
      assert.equal(left.statusCode, 200);
      const leftBody = left.json() as {
        released: boolean;
        seatId: string;
        seats: Array<{ seatId: string; kind: string; displayName: string | null }>;
      };
      assert.equal(leftBody.released, true);
      assert.equal(leftBody.seatId, "2");
      const seat2 = leftBody.seats.find((s) => s.seatId === "2");
      assert.equal(seat2?.kind, "open");
      assert.equal(seat2?.displayName, null);

      // 旧凭证即刻作废：不能再改名/回席。
      const staleRename = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${ctx.code}/seats/2`,
        headers: authHeaders(ctx.guest, ctx.guestSeat),
        payload: { displayName: "灰狐" },
      });
      assert.equal(staleRename.statusCode, 403);
      const staleMe = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ORIGIN, cookie: `${ctx.guest.cookie}; ${ctx.guestSeat}` },
      });
      assert.equal((staleMe.json() as { seat: unknown }).seat, null);

      // 他人可立即入座释放出的座位。
      const newcomer = await openSession(app);
      const reclaimed = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/2/claim`,
        headers: authHeaders(newcomer),
        payload: { displayName: "新人" },
      });
      assert.equal(reclaimed.statusCode, 200);
    } finally {
      await app.close();
    }
  });

  it("rejects leaving during a match, without a credential, and for the host seat", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });
    try {
      const ctx = await createLobbyWithGuest(app);

      // 无座位凭证 → 403。
      const anonymous = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/leave`,
        headers: authHeaders(await openSession(app)),
      });
      assert.equal(anonymous.statusCode, 403);

      // 房主（本地座位）没有可让出的远程座位 → 403。
      const hostLeave = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/leave`,
        headers: authHeaders(ctx.host, ctx.hostSeat),
      });
      assert.equal(hostLeave.statusCode, 403);

      // 开局后大厅语义消失 → 409。
      for (const seatId of ["3", "4", "5", "6"]) {
        await app.inject({
          method: "PATCH",
          url: `/api/rooms/${ctx.code}/seats/${seatId}/config`,
          headers: authHeaders(ctx.host, ctx.hostSeat),
          payload: { kind: "closed" },
        });
      }
      const started = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/start`,
        headers: authHeaders(ctx.host, ctx.hostSeat),
      });
      assert.equal(started.statusCode, 200);
      const inMatch = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/leave`,
        headers: authHeaders(ctx.guest, ctx.guestSeat),
      });
      assert.equal(inMatch.statusCode, 409);
      assert.equal((inMatch.json() as { error: string }).error, "room_not_lobby");
    } finally {
      await app.close();
    }
  });

  it("persists the seat credential cookie with a 30-day Max-Age", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });
    try {
      const host = await openSession(app);
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers: authHeaders(host),
      });
      assert.equal(created.statusCode, 200);
      const seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");
      assert.ok(seatCookie);
      // 浏览器重启后仍能回席：Cookie 必须带 Max-Age（30 天）。
      const rawHeaders = (created.headers["set-cookie"] as string | string[])
        ? ([] as string[]).concat(created.headers["set-cookie"] as never)
        : [];
      const rawSeat = rawHeaders.find((header) => header.startsWith("coup_seat="));
      assert.ok(rawSeat);
      assert.match(rawSeat, /Max-Age=2592000/);
      assert.match(rawSeat, /HttpOnly/);
      assert.match(rawSeat, /SameSite=Strict/);
    } finally {
      await app.close();
    }
  });

  it("wires the leave endpoint for brass and splendor prefixes", async () => {
    for (const prefix of ["brass", "splendor"]) {
      const app = await createApp({
        webRoot: await tempWebRoot(),
        dbPath: await tempDbPath(),
        ...hostAppOptions(),
      });
      try {
        const host = await openSession(app);
        const created = await app.inject({
          method: "POST",
          url: `/api/${prefix}/rooms`,
          headers: authHeaders(host),
        });
        assert.equal(created.statusCode, 200);
        const { code } = created.json() as { code: string };

        const guest = await openSession(app);
        const claimed = await app.inject({
          method: "POST",
          url: `/api/${prefix}/rooms/${code}/seats/2/claim`,
          headers: authHeaders(guest),
          payload: { displayName: "G" },
        });
        assert.equal(claimed.statusCode, 200);
        const guestSeat = cookieFrom(claimed.headers["set-cookie"], "coup_seat");
        assert.ok(guestSeat);

        const left = await app.inject({
          method: "POST",
          url: `/api/${prefix}/rooms/${code}/seats/leave`,
          headers: authHeaders(guest, guestSeat),
        });
        assert.equal(left.statusCode, 200);
        const seats = (left.json() as { seats: Array<{ seatId: string; kind: string }> }).seats;
        assert.equal(seats.find((s) => s.seatId === "2")?.kind, "open");
      } finally {
        await app.close();
      }
    }
  });
});
