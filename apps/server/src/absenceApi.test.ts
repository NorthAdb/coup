import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";
import { GRACE_MS, SOFT_TIMEOUT_MS } from "./seatAbsence.js";
import { HEARTBEAT_LEASE_MS } from "./seatPresenceTracker.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-absence-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-absence-db-"));
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

async function startHostGuestMatch(
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
  const guestCookie = `${guest.cookie}; ${guestSeat}`;

  const started = await app.inject({
    method: "POST",
    url: `/api/rooms/${code}/start`,
    headers: {
      origin: host.origin,
      cookie: hostCookie,
      "x-csrf-token": host.csrfToken,
    },
  });
  assert.equal(started.statusCode, 200);

  return {
    host,
    guest,
    code,
    hostCookie,
    guestCookie,
    guestSeatCookie: guestSeat,
  };
}

describe("absence presence projection", () => {
  it("moves reconnecting → absent → timed_out on injected clock after missed heartbeat", async () => {
    let now = 1_000_000;
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
      now: () => now,
    });

    try {
      const ctx = await startHostGuestMatch(app);

      const beat = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/heartbeat`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      assert.equal(beat.statusCode, 200);

      now += HEARTBEAT_LEASE_MS + 1;
      const grace = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
        },
      });
      assert.equal(grace.statusCode, 200);
      const graceBody = grace.json() as {
        absences: Array<{ seatId: string; phase: string; remainingMs: number }>;
      };
      const seat2 = graceBody.absences.find((a) => a.seatId === "2");
      assert.ok(seat2);
      assert.equal(seat2.phase, "reconnecting");
      assert.ok(seat2.remainingMs <= GRACE_MS);

      now += GRACE_MS;
      const absent = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });
      const absentBody = absent.json() as {
        absences: Array<{ seatId: string; phase: string }>;
      };
      assert.equal(
        absentBody.absences.find((a) => a.seatId === "2")?.phase,
        "absent",
      );

      now += SOFT_TIMEOUT_MS;
      const timed = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });
      const timedBody = timed.json() as {
        absences: Array<{ seatId: string; phase: string }>;
      };
      assert.equal(
        timedBody.absences.find((a) => a.seatId === "2")?.phase,
        "timed_out",
      );

      // Soft timeout alone does not revoke credential — me still resolves.
      const me = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      assert.equal(me.statusCode, 200);
      assert.equal((me.json() as { seat: { seatId: string } | null }).seat?.seatId, "2");
    } finally {
      await app.close();
    }
  });
});

describe("seat resume rotates credential", () => {
  it("rotates coup_seat on successful resume and clears absence", async () => {
    let now = 2_000_000;
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
      now: () => now,
    });

    try {
      const ctx = await startHostGuestMatch(app);
      await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/heartbeat`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      now += HEARTBEAT_LEASE_MS + 1;
      await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });

      const resumed = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/resume-seat`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      assert.equal(resumed.statusCode, 200);
      const newSeat = cookieFrom(resumed.headers["set-cookie"], "coup_seat");
      assert.ok(newSeat);
      assert.notEqual(newSeat, ctx.guestSeatCookie);

      const presence = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });
      const body = presence.json() as {
        absences: Array<{ seatId: string }>;
      };
      assert.equal(
        body.absences.find((a) => a.seatId === "2"),
        undefined,
      );

      // Old cookie no longer binds.
      const stale = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: {
          origin: ctx.guest.origin,
          cookie: `${ctx.guest.cookie}; ${ctx.guestSeatCookie}`,
        },
      });
      assert.equal((stale.json() as { seat: unknown }).seat, null);

      const fresh = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: {
          origin: ctx.guest.origin,
          cookie: `${ctx.guest.cookie}; ${newSeat}`,
        },
      });
      assert.equal(
        (fresh.json() as { seat: { seatId: string } }).seat.seatId,
        "2",
      );
    } finally {
      await app.close();
    }
  });
});

describe("pause when absent seat owes a decision", () => {
  it("exposes pausedForAbsenceSeatId when the deciding remote seat is absent", async () => {
    let now = 6_000_000;
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
      now: () => now,
    });

    try {
      const ctx = await startHostGuestMatch(app);
      // Match starts on seat 1 (host). Advance clock so seat 2 is absent —
      // no pause yet because seat 2 does not owe a decision.
      now += HEARTBEAT_LEASE_MS + 1 + GRACE_MS;
      const hostView = await app.inject({
        method: "GET",
        url: "/api/matches/current",
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });
      assert.equal(hostView.statusCode, 200);
      const early = hostView.json() as {
        pausedForAbsenceSeatId: string | null;
        view: {
          stateVersion: number;
          publicState: { currentSeatId: string };
          legalDecisions: Array<{
            type: string;
            action?: { type?: string };
          }>;
        };
      };
      assert.equal(early.pausedForAbsenceSeatId, null);
      assert.equal(early.view.publicState.currentSeatId, "1");
      assert.ok(early.view.legalDecisions.length > 0);

      // Host takes income so turn advances to seat 2.
      const income = early.view.legalDecisions.find(
        (d) =>
          d.type === "declare_action" && d.action?.type === "income",
      );
      assert.ok(income);
      const decided = await app.inject({
        method: "POST",
        url: "/api/matches/current/decision",
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "content-type": "application/json",
        },
        payload: {
          protocolVersion: 1,
          requestId: "req-pause-income",
          stateVersion: early.view.stateVersion,
          decision: income,
        },
      });
      assert.equal(decided.statusCode, 200);

      const paused = await app.inject({
        method: "GET",
        url: "/api/matches/current",
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });
      const pausedBody = paused.json() as {
        pausedForAbsenceSeatId: string | null;
        view: { publicState: { currentSeatId: string; phase: string } };
        absences: Array<{ seatId: string; phase: string }>;
      };
      assert.equal(pausedBody.view.publicState.currentSeatId, "2");
      assert.equal(pausedBody.view.publicState.phase, "await_action");
      assert.equal(pausedBody.pausedForAbsenceSeatId, "2");
      assert.equal(
        pausedBody.absences.find((a) => a.seatId === "2")?.phase,
        "absent",
      );
    } finally {
      await app.close();
    }
  });
});

describe("host dispositions", () => {
  it("extend_wait resets soft timeout; swap_agent revokes credential", async () => {
    let now = 3_000_000;
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
      now: () => now,
    });

    try {
      const ctx = await startHostGuestMatch(app);
      await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/heartbeat`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      now += HEARTBEAT_LEASE_MS + 1 + GRACE_MS + SOFT_TIMEOUT_MS;
      await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });

      const extended = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/2/disposition`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
          "content-type": "application/json",
        },
        payload: { action: "extend_wait" },
      });
      assert.equal(extended.statusCode, 200);
      const afterExtend = extended.json() as {
        absences: Array<{ seatId: string; phase: string; remainingMs: number }>;
      };
      const seat = afterExtend.absences.find((a) => a.seatId === "2");
      assert.equal(seat?.phase, "absent");
      assert.ok((seat?.remainingMs ?? 0) > SOFT_TIMEOUT_MS - 1000);

      // Credential still valid after extend.
      const me = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      assert.equal((me.json() as { seat: { seatId: string } }).seat.seatId, "2");

      const swapped = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/2/disposition`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
          "content-type": "application/json",
        },
        payload: {
          action: "swap_agent",
          displayName: "灰狐",
          cli: "stub",
          modelId: "stub/placeholder",
        },
      });
      assert.equal(swapped.statusCode, 200);

      const revoked = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      assert.equal((revoked.json() as { seat: unknown }).seat, null);

      const room = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });
      const seats = (room.json() as { seats: Array<{ seatId: string; kind: string }> })
        .seats;
      assert.equal(seats.find((s) => s.seatId === "2")?.kind, "local_agent");
    } finally {
      await app.close();
    }
  });

  it("technical_abort ends the run; force_eliminate removes the seat from play", async () => {
    let now = 4_000_000;
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
      now: () => now,
    });

    try {
      const ctx = await startHostGuestMatch(app);
      await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/heartbeat`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      now += HEARTBEAT_LEASE_MS + 1 + GRACE_MS;
      await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });

      const eliminated = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/2/disposition`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
          "content-type": "application/json",
        },
        payload: { action: "force_eliminate" },
      });
      assert.equal(eliminated.statusCode, 200);
      const elimBody = eliminated.json() as {
        view: { publicState: { seats: Array<{ seatId: string; eliminated: boolean }> } };
      };
      assert.equal(
        elimBody.view.publicState.seats.find((s) => s.seatId === "2")?.eliminated,
        true,
      );

      const revoked = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      assert.equal((revoked.json() as { seat: unknown }).seat, null);
    } finally {
      await app.close();
    }
  });

  it("technical_abort marks run technical_abort and revokes guest credential", async () => {
    let now = 5_000_000;
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
      now: () => now,
    });

    try {
      const ctx = await startHostGuestMatch(app);
      await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/heartbeat`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      now += HEARTBEAT_LEASE_MS + 1 + GRACE_MS;
      await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/presence`,
        headers: { origin: ctx.host.origin, cookie: ctx.hostCookie },
      });

      const aborted = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/2/disposition`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
          "content-type": "application/json",
        },
        payload: { action: "technical_abort" },
      });
      assert.equal(aborted.statusCode, 200);
      const body = aborted.json() as {
        aborted: boolean;
        matchId: string;
      };
      assert.equal(body.aborted, true);

      const events = await app.inject({
        method: "GET",
        url: `/api/matches/${body.matchId}/events`,
      });
      assert.equal(
        (events.json() as { runStatus: string }).runStatus,
        "technical_abort",
      );

      const revoked = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      assert.equal((revoked.json() as { seat: unknown }).seat, null);
    } finally {
      await app.close();
    }
  });
});
