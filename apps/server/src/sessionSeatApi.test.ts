import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-session-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-session-db-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function hostAppOptions(
  overrides: {
    lanHosts?: string[];
  } = {},
) {
  const lanHosts = overrides.lanHosts ?? ["192.168.1.42"];
  return {
    hosting: {
      getState: () =>
        ({
          bindMode: "host" as const,
          listenHost: "0.0.0.0",
          port: 8787,
        }) as const,
      ensureHostMode: async () =>
        ({
          bindMode: "host" as const,
          listenHost: "0.0.0.0",
          port: 8787,
        }) as const,
    },
    listNetworkInterfaces: () => ({
      Ethernet: lanHosts.map((address) => ({
        address,
        family: "IPv4" as const,
        internal: false,
      })),
    }),
  };
}

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

function cookieAttrs(setCookie: string | string[] | undefined, name: string) {
  const headers = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return headers.find((header) => header.startsWith(`${name}=`)) ?? null;
}

type LobbySeat = {
  seatId: string;
  kind: "local_human" | "open" | "remote_human";
  displayName: string | null;
};

type SessionClient = {
  origin: string;
  cookie: string;
  csrfToken: string;
};

async function openSession(
  app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
): Promise<SessionClient> {
  const response = await app.inject({
    method: "GET",
    url: "/api/session",
    headers: { origin },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { csrfToken: string };
  const sessionPair = cookieFrom(response.headers["set-cookie"], "coup_session");
  assert.ok(sessionPair);
  return { origin, cookie: sessionPair, csrfToken: body.csrfToken };
}

async function createHostRoom(
  app: Awaited<ReturnType<typeof createApp>>,
  host: SessionClient,
) {
  const created = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: {
      origin: host.origin,
      cookie: host.cookie,
      "x-csrf-token": host.csrfToken,
    },
  });
  assert.equal(created.statusCode, 200);
  const body = created.json() as { code: string; seats: LobbySeat[] };
  const seatCookie = cookieFrom(created.headers["set-cookie"], "coup_seat");
  return { body, seatCookie, setCookie: created.headers["set-cookie"] };
}

describe("multi-origin session", () => {
  it("issues process session cookie and csrf for an allowed LAN origin", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { origin: "http://192.168.1.42:8787" },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json() as {
        csrfToken: string;
        allowedOrigins: string[];
      };
      assert.ok(body.csrfToken.length >= 16);
      assert.ok(
        body.allowedOrigins.includes("http://192.168.1.42:8787"),
      );
      assert.ok(body.allowedOrigins.includes("http://127.0.0.1:8787"));

      const sessionCookie = cookieAttrs(
        response.headers["set-cookie"],
        "coup_session",
      );
      assert.ok(sessionCookie);
      assert.match(sessionCookie, /HttpOnly/i);
      assert.match(sessionCookie, /SameSite=Strict/i);
      assert.ok(!sessionCookie.toLowerCase().includes("coup_seat="));
    } finally {
      await app.close();
    }
  });

  it("rejects session bootstrap from a foreign origin", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { origin: "http://evil.example:8787" },
      });
      assert.equal(response.statusCode, 403);
      assert.equal((response.json() as { error: string }).error, "origin_not_allowed");
    } finally {
      await app.close();
    }
  });

  it("accepts session bootstrap with Host when Origin is omitted", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { host: "192.168.1.42:8787" },
      });
      assert.equal(response.statusCode, 200);
      assert.ok((response.json() as { csrfToken: string }).csrfToken.length >= 16);
    } finally {
      await app.close();
    }
  });
});

describe("seat claim and credentials", () => {
  it("creates room with seat 1 as local human and issues host seat cookie", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body, seatCookie, setCookie } = await createHostRoom(app, host);
      assert.equal(body.seats[0]?.seatId, "1");
      assert.equal(body.seats[0]?.kind, "local_human");
      assert.equal(body.seats[1]?.kind, "open");
      assert.ok(seatCookie);
      const seatHeader = cookieAttrs(setCookie, "coup_seat");
      assert.ok(seatHeader);
      assert.match(seatHeader, /HttpOnly/i);
      assert.match(seatHeader, /SameSite=Strict/i);
      // Process session cookie must remain a separate jar entry.
      assert.ok(cookieFrom(setCookie, "coup_session") || host.cookie);
    } finally {
      await app.close();
    }
  });

  it("lets a guest claim an open seat with csrf and returns a seat credential", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body: room } = await createHostRoom(app, host);

      const guest = await openSession(app, "http://192.168.1.42:8787");
      const claimed = await app.inject({
        method: "POST",
        url: `/api/rooms/${room.code}/seats/2/claim`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
        },
        payload: { displayName: "灰狐" },
      });
      assert.equal(claimed.statusCode, 200);
      const claimBody = claimed.json() as {
        seat: LobbySeat;
        seats: LobbySeat[];
      };
      assert.equal(claimBody.seat.seatId, "2");
      assert.equal(claimBody.seat.kind, "remote_human");
      assert.equal(claimBody.seat.displayName, "灰狐");
      assert.equal(
        claimBody.seats.find((s) => s.seatId === "2")?.kind,
        "remote_human",
      );

      const seatCookie = cookieAttrs(claimed.headers["set-cookie"], "coup_seat");
      assert.ok(seatCookie);
      assert.match(seatCookie, /HttpOnly/i);
      assert.match(seatCookie, /SameSite=Strict/i);
      assert.ok(!seatCookie.startsWith("coup_session="));
    } finally {
      await app.close();
    }
  });

  it("rejects claim without csrf token", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body: room } = await createHostRoom(app, host);
      const guest = await openSession(app, "http://192.168.1.42:8787");
      const claimed = await app.inject({
        method: "POST",
        url: `/api/rooms/${room.code}/seats/2/claim`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
        },
        payload: { displayName: "灰狐" },
      });
      assert.equal(claimed.statusCode, 403);
      assert.equal((claimed.json() as { error: string }).error, "csrf_required");
    } finally {
      await app.close();
    }
  });

  it("rejects claiming seat 1 or an already claimed seat", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body: room } = await createHostRoom(app, host);
      const guest = await openSession(app, "http://192.168.1.42:8787");

      const seat1 = await app.inject({
        method: "POST",
        url: `/api/rooms/${room.code}/seats/1/claim`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
        },
        payload: { displayName: "入侵者" },
      });
      assert.equal(seat1.statusCode, 409);
      assert.equal((seat1.json() as { error: string }).error, "seat_not_open");

      await app.inject({
        method: "POST",
        url: `/api/rooms/${room.code}/seats/2/claim`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
        },
        payload: { displayName: "灰狐" },
      });

      const other = await openSession(app, "http://192.168.1.42:8787");
      const taken = await app.inject({
        method: "POST",
        url: `/api/rooms/${room.code}/seats/2/claim`,
        headers: {
          origin: other.origin,
          cookie: other.cookie,
          "x-csrf-token": other.csrfToken,
        },
        payload: { displayName: "白塔" },
      });
      assert.equal(taken.statusCode, 409);
      assert.equal((taken.json() as { error: string }).error, "seat_not_open");
    } finally {
      await app.close();
    }
  });

  it("lets the seat holder rename and both clients see lobby claims", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body: room, seatCookie: hostSeat } = await createHostRoom(
        app,
        host,
      );
      assert.ok(hostSeat);

      const guest = await openSession(app, "http://192.168.1.42:8787");
      const claimed = await app.inject({
        method: "POST",
        url: `/api/rooms/${room.code}/seats/2/claim`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
        },
        payload: { displayName: "灰狐" },
      });
      assert.equal(claimed.statusCode, 200);
      const guestSeat = cookieFrom(claimed.headers["set-cookie"], "coup_seat");
      assert.ok(guestSeat);

      const renamed = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${room.code}/seats/2`,
        headers: {
          origin: guest.origin,
          cookie: `${guest.cookie}; ${guestSeat}`,
          "x-csrf-token": guest.csrfToken,
        },
        payload: { displayName: "白塔" },
      });
      assert.equal(renamed.statusCode, 200);
      assert.equal(
        (renamed.json() as { seat: LobbySeat }).seat.displayName,
        "白塔",
      );

      const hostView = await app.inject({
        method: "GET",
        url: `/api/rooms/${room.code}`,
        headers: { origin: host.origin, cookie: `${host.cookie}; ${hostSeat}` },
      });
      const guestView = await app.inject({
        method: "GET",
        url: `/api/rooms/${room.code}`,
        headers: {
          origin: guest.origin,
          cookie: `${guest.cookie}; ${guestSeat}`,
        },
      });
      assert.equal(hostView.statusCode, 200);
      assert.equal(guestView.statusCode, 200);
      const hostSeats = (hostView.json() as { seats: LobbySeat[] }).seats;
      const guestSeats = (guestView.json() as { seats: LobbySeat[] }).seats;
      assert.equal(hostSeats.find((s) => s.seatId === "1")?.kind, "local_human");
      assert.equal(hostSeats.find((s) => s.seatId === "2")?.displayName, "白塔");
      assert.equal(guestSeats.find((s) => s.seatId === "2")?.kind, "remote_human");
      assert.equal(guestSeats.find((s) => s.seatId === "2")?.displayName, "白塔");
    } finally {
      await app.close();
    }
  });

  it("recognizes the holder via seat credential without exposing the hash", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body: room } = await createHostRoom(app, host);
      const guest = await openSession(app, "http://192.168.1.42:8787");
      const claimed = await app.inject({
        method: "POST",
        url: `/api/rooms/${room.code}/seats/3/claim`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
        },
        payload: { displayName: "灰狐" },
      });
      const guestSeat = cookieFrom(claimed.headers["set-cookie"], "coup_seat");
      assert.ok(guestSeat);

      const me = await app.inject({
        method: "GET",
        url: `/api/rooms/${room.code}/me`,
        headers: {
          origin: guest.origin,
          cookie: `${guest.cookie}; ${guestSeat}`,
        },
      });
      assert.equal(me.statusCode, 200);
      const body = me.json() as {
        seat: LobbySeat | null;
        seats: LobbySeat[];
      };
      assert.equal(body.seat?.seatId, "3");
      assert.equal(body.seat?.displayName, "灰狐");
      assert.ok(!JSON.stringify(body).includes("credentialHash"));
      assert.ok(!JSON.stringify(body).toLowerCase().includes("sha"));
    } finally {
      await app.close();
    }
  });
});
