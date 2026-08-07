import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";
import { GRACE_MS, SOFT_TIMEOUT_MS } from "./seatAbsence.js";
import { HEARTBEAT_LEASE_MS } from "./seatPresenceTracker.js";
import { openRoomStore } from "./roomStore.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-recovery-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-recovery-db-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function hostAppOptions() {
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
      Ethernet: [
        {
          address: "192.168.1.42",
          family: "IPv4" as const,
          internal: false,
        },
      ],
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

async function createLobbyWithGuest(
  app: Awaited<ReturnType<typeof createApp>>,
) {
  const host = await openSession(app, "http://192.168.1.42:8787");
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
  const room = created.json() as { code: string };
  const hostSeat = cookieFrom(created.headers["set-cookie"], "coup_seat");
  assert.ok(hostSeat);
  const hostCookie = `${host.cookie}; ${hostSeat}`;
  const code = room.code;

  for (const seatId of ["3", "4", "5", "6"]) {
    const closed = await app.inject({
      method: "PATCH",
      url: `/api/rooms/${code}/seats/${seatId}/config`,
      headers: {
        origin: host.origin,
        cookie: hostCookie,
        "x-csrf-token": host.csrfToken,
        "content-type": "application/json",
      },
      payload: { kind: "closed" },
    });
    assert.equal(closed.statusCode, 200);
  }

  const guest = await openSession(app, "http://192.168.1.42:8787");
  const claimed = await app.inject({
    method: "POST",
    url: `/api/rooms/${code}/seats/2/claim`,
    headers: {
      origin: guest.origin,
      cookie: guest.cookie,
      "x-csrf-token": guest.csrfToken,
      "content-type": "application/json",
    },
    payload: { displayName: "灰狐" },
  });
  assert.equal(claimed.statusCode, 200);
  const guestSeat = cookieFrom(claimed.headers["set-cookie"], "coup_seat");
  assert.ok(guestSeat);

  return {
    host,
    guest,
    code,
    hostCookie,
    guestCookie: `${guest.cookie}; ${guestSeat}`,
    guestSeatCookie: guestSeat,
  };
}

async function startMatchFromLobby(
  app: Awaited<ReturnType<typeof createApp>>,
  ctx: Awaited<ReturnType<typeof createLobbyWithGuest>>,
) {
  const started = await app.inject({
    method: "POST",
    url: `/api/rooms/${ctx.code}/start`,
    headers: {
      origin: ctx.host.origin,
      cookie: ctx.hostCookie,
      "x-csrf-token": ctx.host.csrfToken,
    },
  });
  assert.equal(started.statusCode, 200);
  return started.json() as { matchId: string };
}

describe("host restart room recovery", () => {
  it("restores lobby room after process restart (same db)", async () => {
    const webRoot = await tempWebRoot();
    const dbPath = await tempDbPath();

    const first = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    const ctx = await createLobbyWithGuest(first);
    await first.close();

    const second = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    try {
      const recovery = await second.inject({
        method: "GET",
        url: "/api/room-recovery",
        headers: { origin: "http://192.168.1.42:8787" },
      });
      assert.equal(recovery.statusCode, 200);
      const body = recovery.json() as {
        status: string;
        room: { code: string; phase: string; seats: Array<{ seatId: string; kind: string; displayName: string | null }> };
      };
      assert.equal(body.status, "restored");
      assert.equal(body.room.code, ctx.code);
      assert.equal(body.room.phase, "lobby");
      const seat2 = body.room.seats.find((s) => s.seatId === "2");
      assert.equal(seat2?.kind, "remote_human");
      assert.equal(seat2?.displayName, "灰狐");

      const roomGet = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}`,
        headers: { origin: "http://192.168.1.42:8787" },
      });
      assert.equal(roomGet.statusCode, 200);
    } finally {
      await second.close();
    }
  });

  it("restores in-progress match with same matchId and event seq (not a new resume run)", async () => {
    const webRoot = await tempWebRoot();
    const dbPath = await tempDbPath();

    const first = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    const ctx = await createLobbyWithGuest(first);
    const started = await first.inject({
      method: "POST",
      url: `/api/rooms/${ctx.code}/start`,
      headers: {
        origin: ctx.host.origin,
        cookie: ctx.hostCookie,
        "x-csrf-token": ctx.host.csrfToken,
      },
    });
    assert.equal(started.statusCode, 200);
    const startBody = started.json() as { matchId: string };
    const matchId = startBody.matchId;

    const eventsBefore = await first.inject({
      method: "GET",
      url: `/api/rooms/${ctx.code}/matches/current`,
      headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
    });
    assert.equal(eventsBefore.statusCode, 200);
    const beforeBody = eventsBefore.json() as {
      matchId: string;
      view: { stateVersion: number; projectedHistory: unknown[] };
    };
    assert.equal(beforeBody.matchId, matchId);
    const lastSeq = beforeBody.view.projectedHistory.length;
    assert.ok(lastSeq > 0);

    await first.close();

    const second = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    try {
      const recovery = await second.inject({
        method: "GET",
        url: "/api/room-recovery",
        headers: { origin: "http://192.168.1.42:8787" },
      });
      assert.equal(recovery.statusCode, 200);
      const body = recovery.json() as {
        status: string;
        room: { code: string; phase: string; matchId: string | null };
      };
      assert.equal(body.status, "restored");
      assert.equal(body.room.code, ctx.code);
      assert.equal(body.room.phase, "match");
      assert.equal(body.room.matchId, matchId);

      const eventsAfter = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/matches/current`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      assert.equal(eventsAfter.statusCode, 200);
      const afterBody = eventsAfter.json() as {
        matchId: string;
        view: { stateVersion: number; projectedHistory: unknown[] };
      };
      assert.equal(afterBody.matchId, matchId);
      assert.equal(afterBody.view.stateVersion, beforeBody.view.stateVersion);
      assert.equal(afterBody.view.projectedHistory.length, lastSeq);

      const me = await openSession(second, "http://192.168.1.42:8787");
      const roomGet = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}`,
        headers: { origin: me.origin },
      });
      assert.equal(roomGet.statusCode, 200);
      const roomBody = roomGet.json() as { phase: string; matchId?: string | null };
      assert.equal(roomBody.phase, "match");
    } finally {
      await second.close();
    }
  });

  it("does not count authority downtime against absence soft timeout; grants fresh grace", async () => {
    const webRoot = await tempWebRoot();
    const dbPath = await tempDbPath();
    let now = 1_000_000;

    const first = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
      now: () => now,
    });
    const ctx = await createLobbyWithGuest(first);
    await startMatchFromLobby(first, ctx);

    // Guest heartbeats, then drops into reconnecting.
    assert.equal(
      (
        await first.inject({
          method: "POST",
          url: `/api/rooms/${ctx.code}/heartbeat`,
          headers: {
            origin: ctx.guest.origin,
            cookie: ctx.guestCookie,
            "x-csrf-token": ctx.guest.csrfToken,
          },
        })
      ).statusCode,
      200,
    );
    now += HEARTBEAT_LEASE_MS + 1;
    const grace = await first.inject({
      method: "GET",
      url: `/api/rooms/${ctx.code}/presence`,
      headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
    });
    assert.equal(grace.statusCode, 200);
    const graceBody = grace.json() as {
      absences: Array<{ seatId: string; phase: string; remainingMs: number }>;
    };
    assert.equal(graceBody.absences[0]?.phase, "reconnecting");

    // Simulate long downtime while authority is down (would exceed soft timeout if counted).
    const downtime = GRACE_MS + SOFT_TIMEOUT_MS + 60_000;
    now += downtime;
    await first.close();

    const second = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
      now: () => now,
    });
    try {
      const presence = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.guest.origin },
      });
      assert.equal(presence.statusCode, 200);
      const body = presence.json() as {
        absences: Array<{ seatId: string; phase: string; remainingMs: number }>;
      };
      const seat2 = body.absences.find((a) => a.seatId === "2");
      assert.ok(seat2);
      assert.equal(seat2.phase, "reconnecting");
      assert.ok(seat2.remainingMs > GRACE_MS - 1000);
      assert.ok(seat2.remainingMs <= GRACE_MS);

      // Soft timeout still requires full grace + 5min after restore — not already timed_out.
      now += GRACE_MS + 1;
      const afterGrace = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.guest.origin },
      });
      const afterBody = afterGrace.json() as {
        absences: Array<{ seatId: string; phase: string }>;
      };
      assert.equal(
        afterBody.absences.find((a) => a.seatId === "2")?.phase,
        "absent",
      );
    } finally {
      await second.close();
    }
  });

  it("reattaches guest with prior seat cookie on same origin after restore", async () => {
    const webRoot = await tempWebRoot();
    const dbPath = await tempDbPath();

    const first = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    const ctx = await createLobbyWithGuest(first);
    await startMatchFromLobby(first, ctx);
    await first.close();

    const second = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    try {
      const guest = await openSession(second, "http://192.168.1.42:8787");
      const guestCookie = `${guest.cookie}; ${ctx.guestSeatCookie}`;

      const me = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: {
          origin: guest.origin,
          cookie: guestCookie,
        },
      });
      assert.equal(me.statusCode, 200);
      const meBody = me.json() as {
        seat: { seatId: string; kind: string; displayName: string | null };
      };
      assert.equal(meBody.seat.seatId, "2");
      assert.equal(meBody.seat.displayName, "灰狐");

      const resumed = await second.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/resume-seat`,
        headers: {
          origin: guest.origin,
          cookie: guestCookie,
          "x-csrf-token": guest.csrfToken,
        },
      });
      assert.equal(resumed.statusCode, 200);
      const resumeBody = resumed.json() as { resumed: boolean };
      assert.equal(resumeBody.resumed, true);
      const newSeat = cookieFrom(resumed.headers["set-cookie"], "coup_seat");
      assert.ok(newSeat);
      assert.notEqual(newSeat, ctx.guestSeatCookie);
    } finally {
      await second.close();
    }
  });

  it("blocks creating a new room while a restored room is active until abandoned", async () => {
    const webRoot = await tempWebRoot();
    const dbPath = await tempDbPath();

    const first = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    const ctx = await createLobbyWithGuest(first);
    await first.close();

    const second = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    try {
      const recovery = await second.inject({
        method: "GET",
        url: "/api/room-recovery",
      });
      assert.equal((recovery.json() as { status: string }).status, "restored");

      const host = await openSession(second, "http://192.168.1.42:8787");
      const blocked = await second.inject({
        method: "POST",
        url: "/api/rooms",
        headers: {
          origin: host.origin,
          cookie: host.cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(blocked.statusCode, 409);
      assert.equal(
        (blocked.json() as { error: string }).error,
        "recovery_pending_abandon",
      );

      const abandoned = await second.inject({
        method: "POST",
        url: "/api/room-recovery/abandon",
        headers: {
          origin: host.origin,
          cookie: host.cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(abandoned.statusCode, 200);

      const oldRoom = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}`,
      });
      assert.equal(oldRoom.statusCode, 404);

      const created = await second.inject({
        method: "POST",
        url: "/api/rooms",
        headers: {
          origin: host.origin,
          cookie: host.cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(created.statusCode, 200);
    } finally {
      await second.close();
    }
  });

  it("blocks creating a new room until failed recovery is abandoned", async () => {
    const webRoot = await tempWebRoot();
    const dbPath = await tempDbPath();

    const first = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    const ctx = await createLobbyWithGuest(first);
    const { matchId } = await startMatchFromLobby(first, ctx);
    await first.close();

    // Corrupt the persisted room payload so boot recovery fails.
    const corrupt = openRoomStore(dbPath);
    corrupt.debugOverwritePayload("{broken");
    corrupt.close();

    const second = await createApp({
      webRoot,
      dbPath,
      ...hostAppOptions(),
    });
    try {
      const recovery = await second.inject({
        method: "GET",
        url: "/api/room-recovery",
      });
      assert.equal(recovery.statusCode, 200);
      const recoveryBody = recovery.json() as {
        status: string;
        message: string | null;
      };
      assert.equal(recoveryBody.status, "failed");
      assert.equal(recoveryBody.message, "无法恢复上一房间");

      const host = await openSession(second, "http://192.168.1.42:8787");
      const blocked = await second.inject({
        method: "POST",
        url: "/api/rooms",
        headers: {
          origin: host.origin,
          cookie: host.cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(blocked.statusCode, 409);
      assert.equal(
        (blocked.json() as { error: string }).error,
        "recovery_pending_abandon",
      );

      // Old room code must not be silently reusable.
      const oldRoom = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}`,
      });
      assert.equal(oldRoom.statusCode, 404);

      const abandoned = await second.inject({
        method: "POST",
        url: "/api/room-recovery/abandon",
        headers: {
          origin: host.origin,
          cookie: host.cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(abandoned.statusCode, 200);

      const run = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/matches/current`,
        headers: { origin: host.origin, cookie: host.cookie },
      });
      assert.equal(run.statusCode, 404);

      const created = await second.inject({
        method: "POST",
        url: "/api/rooms",
        headers: {
          origin: host.origin,
          cookie: host.cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(created.statusCode, 200);
      const newCode = (created.json() as { code: string }).code;
      // May reuse digits by chance; voiding means old credentials/code binding is gone.
      // Stronger check: guest old cookie cannot attach to any restored prior room.
      assert.ok(typeof newCode === "string" && newCode.length === 4);

      const staleMe = await second.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: {
          origin: host.origin,
          cookie: `${host.cookie}; ${ctx.guestSeatCookie}`,
        },
      });
      assert.equal(staleMe.statusCode, 404);
    } finally {
      await second.close();
    }
  });
});
