import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";
import { createRoomRegistry } from "./roomRegistry.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-room-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-room-db-"));
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

async function authedHeaders(
  app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
) {
  const session = await app.inject({
    method: "GET",
    url: "/api/session",
    headers: { origin },
  });
  assert.equal(session.statusCode, 200);
  const csrfToken = (session.json() as { csrfToken: string }).csrfToken;
  const cookie = cookieFrom(session.headers["set-cookie"], "coup_session");
  assert.ok(cookie);
  return {
    origin,
    cookie,
    "x-csrf-token": csrfToken,
  };
}

describe("room invite API", () => {
  it("keeps multiple lobby rooms isolated and restores every room", async () => {
    const dbPath = await tempDbPath();
    const options = {
      webRoot: await tempWebRoot(),
      dbPath,
      hosting: {
        getState: () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
        ensureHostMode: async () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
      }),
    };

    const app = await createApp(options);
    const host = await authedHeaders(app, "http://192.168.1.42:8787");
    const first = await app.inject({ method: "POST", url: "/api/rooms", headers: host });
    assert.equal(first.statusCode, 200);
    const firstCode = (first.json() as { code: string }).code;
    const firstSeat = cookieFrom(first.headers["set-cookie"], "coup_seat");
    assert.ok(firstSeat);

    const second = await app.inject({ method: "POST", url: "/api/rooms", headers: host });
    assert.equal(second.statusCode, 200);
    const secondCode = (second.json() as { code: string }).code;
    assert.notEqual(secondCode, firstCode);
    const secondSeat = cookieFrom(second.headers["set-cookie"], "coup_seat");
    assert.ok(secondSeat);

    const firstGuest = await app.inject({
      method: "POST",
      url: `/api/rooms/${firstCode}/seats/2/claim`,
      headers: { ...host, cookie: `${host.cookie}; ${firstSeat}` },
      payload: { displayName: "A 客人" },
    });
    assert.equal(firstGuest.statusCode, 200);

    const wrongRoomRename = await app.inject({
      method: "PATCH",
      url: `/api/rooms/${secondCode}/seats/1`,
      headers: {
        ...host,
        cookie: `${host.cookie}; ${firstSeat}`,
        "content-type": "application/json",
      },
      payload: { displayName: "错误房间" },
    });
    assert.equal(wrongRoomRename.statusCode, 403);

    const firstLookup = await app.inject({ method: "GET", url: `/api/rooms/${firstCode}` });
    const secondLookup = await app.inject({ method: "GET", url: `/api/rooms/${secondCode}` });
    assert.equal(firstLookup.statusCode, 200);
    assert.equal(secondLookup.statusCode, 200);
    assert.equal(
      (firstLookup.json() as { seats: Array<{ seatId: string; kind: string }> }).seats.find((seat) => seat.seatId === "2")?.kind,
      "remote_human",
    );
    assert.equal(
      (secondLookup.json() as { seats: Array<{ seatId: string; kind: string }> }).seats.find((seat) => seat.seatId === "2")?.kind,
      "open",
    );
    await app.close();

    const reopened = await createApp(options);
    try {
      for (const code of [firstCode, secondCode]) {
        const lookup = await reopened.inject({ method: "GET", url: `/api/rooms/${code}` });
        assert.equal(lookup.statusCode, 200);
      }
    } finally {
      await reopened.close();
    }
  });

  it("creates a room in host mode and returns join url", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [
          { address: "192.168.1.42", family: "IPv4", internal: false },
        ],
        lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://192.168.1.42:8787");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      assert.equal(created.statusCode, 200);
      const body = created.json() as {
        code: string;
        joinUrl: string;
        selectedHost: string;
        port: number;
        bindMode: string;
        lanOrigin: string;
      };
      assert.match(body.code, /^\d{4}$/);
      assert.equal(body.port, 8787);
      assert.equal(body.bindMode, "host");
      assert.equal(body.selectedHost, "192.168.1.42");
      assert.equal(
        body.joinUrl,
        `http://192.168.1.42:8787/join?code=${body.code}`,
      );
      assert.equal(body.lanOrigin, "http://192.168.1.42:8787");

      const lookup = await app.inject({
        method: "GET",
        url: `/api/rooms/${body.code}`,
      });
      assert.equal(lookup.statusCode, 200);
      assert.equal((lookup.json() as { code: string }).code, body.code);

      const missing = await app.inject({
        method: "GET",
        url: "/api/rooms/0001",
      });
      assert.equal(missing.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it("returns need_host_mode when still on loopback", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "local",
          listenHost: "127.0.0.1",
          port: 3456,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [
          { address: "192.168.1.42", family: "IPv4", internal: false },
        ],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://127.0.0.1:3456");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      assert.equal(created.statusCode, 409);
      assert.equal(
        (created.json() as { error: string }).error,
        "need_host_mode",
      );
    } finally {
      await app.close();
    }
  });

  it("rejects create when no lan ipv4 is available", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://127.0.0.1:8787");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      assert.equal(created.statusCode, 400);
      assert.equal((created.json() as { error: string }).error, "no_lan_ipv4");
    } finally {
      await app.close();
    }
  });

  it("throttles wrong room-code lookups per IP after repeated failures", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [
          { address: "192.168.1.42", family: "IPv4", internal: false },
        ],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://192.168.1.42:8787");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      const code = (created.json() as { code: string }).code;

      for (let i = 0; i < 10; i += 1) {
        const miss = await app.inject({
          method: "GET",
          url: "/api/rooms/0001",
        });
        assert.equal(miss.statusCode, 404);
      }
      const blocked = await app.inject({
        method: "GET",
        url: "/api/rooms/0001",
      });
      assert.equal(blocked.statusCode, 429);
      assert.equal(
        (blocked.json() as { error: string }).error,
        "too_many_attempts",
      );

      // A successful lookup clears the throttle for that IP.
      const ok = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}`,
      });
      assert.equal(ok.statusCode, 200);
      const after = await app.inject({
        method: "GET",
        url: "/api/rooms/0001",
      });
      assert.equal(after.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it("rejects the twenty-first concurrent room with a capacity error", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
        ensureHostMode: async () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://192.168.1.42:8787");
      for (let i = 0; i < 20; i += 1) {
        const created = await app.inject({ method: "POST", url: "/api/rooms", headers });
        assert.equal(created.statusCode, 200);
      }
      const rejected = await app.inject({ method: "POST", url: "/api/rooms", headers });
      assert.equal(rejected.statusCode, 503);
      assert.deepEqual(rejected.json(), {
        error: "room_capacity_reached",
        message: "房间已满，稍后再试",
      });
    } finally {
      await app.close();
    }
  });

  it("reclaims an empty room before checking capacity", async () => {
    let clock = 1_000_000;
    const rooms = createRoomRegistry();
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      rooms,
      now: () => clock,
      hosting: {
        getState: () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
        ensureHostMode: async () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://192.168.1.42:8787");
      const first = await app.inject({ method: "POST", url: "/api/rooms", headers });
      assert.equal(first.statusCode, 200);
      const firstCode = (first.json() as { code: string }).code;
      const firstRoom = rooms.getByCode(firstCode);
      assert.ok(firstRoom);
      firstRoom.seats[0]!.kind = "open";
      firstRoom.seats[0]!.credentialHash = null;

      clock += 30 * 60_000;
      const replacement = await app.inject({ method: "POST", url: "/api/rooms", headers });
      assert.equal(replacement.statusCode, 200);
      assert.equal((await app.inject({ method: "GET", url: `/api/rooms/${firstCode}` })).statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it("counts room snapshot polling as activity but not other read-only queries", async () => {
    let clock = 1_000_000;
    const rooms = createRoomRegistry();
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      rooms,
      now: () => clock,
      hosting: {
        getState: () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
        ensureHostMode: async () => ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://192.168.1.42:8787");
      const first = await app.inject({ method: "POST", url: "/api/rooms", headers });
      const firstCode = (first.json() as { code: string }).code;

      clock += 30 * 60_000;
      const snapshot = await app.inject({ method: "GET", url: `/api/rooms/${firstCode}` });
      assert.equal(snapshot.statusCode, 200);
      clock += 29 * 60_000;
      await app.inject({ method: "POST", url: "/api/rooms", headers });
      assert.equal((await app.inject({ method: "GET", url: `/api/rooms/${firstCode}/me` })).statusCode, 200);

      clock += 60_000;
      await app.inject({ method: "POST", url: "/api/rooms", headers });
      assert.equal((await app.inject({ method: "GET", url: `/api/rooms/${firstCode}/me` })).statusCode, 404);

      const second = await app.inject({ method: "POST", url: "/api/rooms", headers });
      const secondCode = (second.json() as { code: string }).code;
      clock += 30 * 60_000;
      const me = await app.inject({ method: "GET", url: `/api/rooms/${secondCode}/me` });
      assert.equal(me.statusCode, 200);
      await app.inject({ method: "POST", url: "/api/rooms", headers });
      assert.equal((await app.inject({ method: "GET", url: `/api/rooms/${secondCode}/me` })).statusCode, 404);
    } finally {
      await app.close();
    }
  });
});
