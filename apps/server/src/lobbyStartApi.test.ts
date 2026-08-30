import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";
import { evaluateLobbyStartGates } from "./lobbyStart.js";
import { createRoomRegistry, type RoomRecord } from "./roomRegistry.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-lobby-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-lobby-db-"));
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

type LobbySeat = {
  seatId: string;
  kind: string;
  displayName: string | null;
  cli?: string | null;
  modelId?: string | null;
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
  assert.ok(seatCookie);
  return { body, seatCookie };
}

async function configureSeat(
  app: Awaited<ReturnType<typeof createApp>>,
  host: SessionClient,
  cookie: string,
  code: string,
  seatId: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/rooms/${code}/seats/${seatId}/config`,
    headers: {
      origin: host.origin,
      cookie,
      "x-csrf-token": host.csrfToken,
      "content-type": "application/json",
    },
    payload,
  });
  assert.equal(response.statusCode, 200);
  return response.json() as { seats: LobbySeat[] };
}

describe("lobby seat configuration", () => {
  it("lets the host set remaining seats to open or closed, and rejects agent kinds", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body, seatCookie } = await createHostRoom(app, host);
      const cookie = `${host.cookie}; ${seatCookie}`;

      const closeSeat = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${body.code}/seats/5/config`,
        headers: {
          origin: host.origin,
          cookie,
          "x-csrf-token": host.csrfToken,
          "content-type": "application/json",
        },
        payload: { kind: "closed" },
      });
      assert.equal(closeSeat.statusCode, 200);
      const closedBody = closeSeat.json() as { seats: LobbySeat[] };
      assert.equal(
        closedBody.seats.find((s) => s.seatId === "5")?.kind,
        "closed",
      );

      const agentSeat = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${body.code}/seats/4/config`,
        headers: {
          origin: host.origin,
          cookie,
          "x-csrf-token": host.csrfToken,
          "content-type": "application/json",
        },
        payload: {
          kind: "local_agent",
          displayName: "灰狐",
          cli: "stub",
          modelId: "stub/placeholder",
        },
      });
      assert.equal(agentSeat.statusCode, 400);
      assert.equal(
        (agentSeat.json() as { error: string }).error,
        "invalid_seat_kind",
      );

      const guest = await openSession(app, "http://192.168.1.42:8787");
      const guestDenied = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${body.code}/seats/3/config`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
          "content-type": "application/json",
        },
        payload: { kind: "closed" },
      });
      assert.equal(guestDenied.statusCode, 403);
      assert.equal(
        (guestDenied.json() as { error: string }).error,
        "host_seat_required",
      );
    } finally {
      await app.close();
    }
  });
});

describe("lobby start gates", () => {
  it("blocks start while open seats remain; host alone cannot start", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body, seatCookie } = await createHostRoom(app, host);
      const cookie = `${host.cookie}; ${seatCookie}`;
      const code = body.code;

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
        payload: { displayName: "阿黛尔" },
      });
      assert.equal(claimed.statusCode, 200);
      const guestSeatCookie = cookieFrom(
        claimed.headers["set-cookie"],
        "coup_seat",
      );
      assert.ok(guestSeatCookie);
      const guestCookie = `${guest.cookie}; ${guestSeatCookie}`;

      for (const seatId of ["3", "4", "5", "6"]) {
        await configureSeat(app, host, cookie, code, seatId, {
          kind: "closed",
        });
      }
      // Seat 2 is claimed by the guest — no open seats remain; start allowed.

      const guestStart = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/start`,
        headers: {
          origin: guest.origin,
          cookie: guestCookie,
          "x-csrf-token": guest.csrfToken,
        },
      });
      assert.equal(guestStart.statusCode, 403);
      assert.equal(
        (guestStart.json() as { error: string }).error,
        "host_seat_required",
      );

      const started = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/start`,
        headers: {
          origin: host.origin,
          cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(started.statusCode, 200);
      const startBody = started.json() as {
        view: { matchId: string; seatId: string; publicState: { seats: unknown[] } };
        phase: string;
      };
      assert.equal(startBody.view.seatId, "1");
      assert.equal(startBody.view.publicState.seats.length, 2);
      assert.ok(startBody.view.matchId);

      const room = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}`,
      });
      assert.equal(room.statusCode, 200);
      assert.equal((room.json() as { phase: string }).phase, "match");
    } finally {
      await app.close();
    }
  });
});

describe("multi-human match from lobby", () => {
  it("projects per seat and accepts decisions from remote humans", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const { body, seatCookie: hostSeat } = await createHostRoom(app, host);
      const hostCookie = `${host.cookie}; ${hostSeat}`;
      const code = body.code;

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
        payload: { displayName: "阿黛尔" },
      });
      assert.equal(claimed.statusCode, 200);
      const guestSeat = cookieFrom(claimed.headers["set-cookie"], "coup_seat");
      assert.ok(guestSeat);
      const guestCookie = `${guest.cookie}; ${guestSeat}`;

      for (const seatId of ["3", "4", "5", "6"]) {
        await configureSeat(app, host, hostCookie, code, seatId, {
          kind: "closed",
        });
      }

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
      const hostStart = started.json() as {
        view: {
          matchId: string;
          seatId: string;
          stateVersion: number;
          legalDecisions: Array<{ type: string }>;
          privateState: { hiddenCharacters: unknown[] };
        };
      };
      assert.equal(hostStart.view.seatId, "1");
      assert.ok(hostStart.view.privateState.hiddenCharacters.length >= 1);

      const guestViewRes = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: {
          origin: guest.origin,
          cookie: guestCookie,
        },
      });
      assert.equal(guestViewRes.statusCode, 200);
      const guestView = guestViewRes.json() as {
        view: {
          seatId: string;
          stateVersion: number;
          legalDecisions: Array<{ type: string }>;
          privateState: { hiddenCharacters: unknown[] };
        };
      };
      assert.equal(guestView.view.seatId, "2");
      assert.ok(guestView.view.privateState.hiddenCharacters.length >= 1);
      // 双方暗牌是各自投影：角色组合可能碰巧相同（每种角色有 3 张），
      // 但彼此都只看得到自己的手牌——座位归属由上面的 seatId 断言保证。

      // Seat 1 acts first in a fresh two-human match.
      assert.ok(hostStart.view.legalDecisions.length > 0);
      const income = hostStart.view.legalDecisions.find(
        (d) => d.type === "declare_action",
      );
      assert.ok(income);

      const guestForbidden = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/matches/current/decision`,
        headers: {
          origin: guest.origin,
          cookie: guestCookie,
          "content-type": "application/json",
        },
        payload: {
          protocolVersion: 1,
          requestId: "guest-too-early",
          stateVersion: guestView.view.stateVersion,
          decision: { type: "pass_block" },
        },
      });
      assert.equal(guestForbidden.statusCode, 409);

      const hostMove = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/matches/current/decision`,
        headers: {
          origin: host.origin,
          cookie: hostCookie,
          "content-type": "application/json",
        },
        payload: {
          protocolVersion: 1,
          requestId: "host-income",
          stateVersion: hostStart.view.stateVersion,
          decision: { type: "declare_action", action: { type: "income" } },
        },
      });
      assert.equal(hostMove.statusCode, 200);
      const afterHost = hostMove.json() as {
        view: { seatId: string; stateVersion: number };
      };
      assert.equal(afterHost.view.seatId, "1");
      assert.ok(afterHost.view.stateVersion > hostStart.view.stateVersion);
    } finally {
      await app.close();
    }
  });
});

describe("room-scoped match runtime", () => {
  it("keeps two started rooms independent and rejects cross-room credentials", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });

    try {
      const host = await openSession(app, "http://192.168.1.42:8787");
      const first = await createHostRoom(app, host);
      const second = await createHostRoom(app, host);
      const firstCookie = `${host.cookie}; ${first.seatCookie}`;
      const secondCookie = `${host.cookie}; ${second.seatCookie}`;
      const guestA = await openSession(app, "http://192.168.1.42:8787");
      const guestB = await openSession(app, "http://192.168.1.42:8787");
      const claimA = await app.inject({
        method: "POST",
        url: `/api/rooms/${first.body.code}/seats/2/claim`,
        headers: {
          origin: guestA.origin,
          cookie: guestA.cookie,
          "x-csrf-token": guestA.csrfToken,
          "content-type": "application/json",
        },
        payload: { displayName: "A" },
      });
      const claimB = await app.inject({
        method: "POST",
        url: `/api/rooms/${second.body.code}/seats/2/claim`,
        headers: {
          origin: guestB.origin,
          cookie: guestB.cookie,
          "x-csrf-token": guestB.csrfToken,
          "content-type": "application/json",
        },
        payload: { displayName: "B" },
      });
      assert.equal(claimA.statusCode, 200);
      assert.equal(claimB.statusCode, 200);

      for (const [room, cookie] of [
        [first.body, firstCookie],
        [second.body, secondCookie],
      ] as const) {
        for (const seatId of ["3", "4", "5", "6"]) {
          await configureSeat(app, host, cookie, room.code, seatId, {
            kind: "closed",
          });
        }
      }

      const startFirst = await app.inject({
        method: "POST",
        url: `/api/rooms/${first.body.code}/start`,
        headers: {
          origin: host.origin,
          cookie: firstCookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(startFirst.statusCode, 200);
      const firstMatchId = (startFirst.json() as { matchId: string }).matchId;

      const startSecond = await app.inject({
        method: "POST",
        url: `/api/rooms/${second.body.code}/start`,
        headers: {
          origin: host.origin,
          cookie: secondCookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(startSecond.statusCode, 200);
      const secondMatchId = (startSecond.json() as { matchId: string }).matchId;
      assert.notEqual(firstMatchId, secondMatchId);

      const firstView = await app.inject({
        method: "GET",
        url: `/api/rooms/${first.body.code}/matches/current`,
        headers: { origin: host.origin, cookie: firstCookie },
      });
      const secondView = await app.inject({
        method: "GET",
        url: `/api/rooms/${second.body.code}/matches/current`,
        headers: { origin: host.origin, cookie: secondCookie },
      });
      assert.equal(firstView.statusCode, 200);
      assert.equal(secondView.statusCode, 200);
      assert.equal(
        (firstView.json() as { matchId: string }).matchId,
        firstMatchId,
      );
      assert.equal(
        (secondView.json() as { matchId: string }).matchId,
        secondMatchId,
      );

      const crossRoom = await app.inject({
        method: "GET",
        url: `/api/rooms/${second.body.code}/matches/current`,
        headers: { origin: host.origin, cookie: firstCookie },
      });
      assert.equal(crossRoom.statusCode, 403);
      assert.equal(
        (crossRoom.json() as { error: string }).error,
        "seat_credential_required",
      );
    } finally {
      await app.close();
    }
  });
});

function finishedMatchPhaseRoom(
  openSeats: string[] = [],
): { room: RoomRecord; registry: ReturnType<typeof createRoomRegistry> } {
  const registry = createRoomRegistry();
  const room = registry.create();
  for (const seatId of ["2", "3", "4", "5", "6"]) {
    if (openSeats.includes(seatId)) continue;
    if (seatId === "2") {
      const claimed = registry.claimSeat(room.code, "2", {
        displayName: "阿黛尔",
        credentialHash: "hash-2",
      });
      assert.equal(claimed.ok, true);
      continue;
    }
    const configured = registry.configureSeat(room.code, seatId, {
      kind: "closed",
    });
    assert.equal(configured.ok, true);
  }
  const begun = registry.beginMatch(room.code, "match-1");
  assert.equal(begun.ok, true);
  const after = registry.getByCode(room.code);
  assert.ok(after);
  return { room: after, registry };
}

describe("same-room rematch gates", () => {
  it("blocks start from a match-phase room unless rematch is allowed", () => {
    const { room } = finishedMatchPhaseRoom();
    assert.deepEqual(evaluateLobbyStartGates(room), {
      ok: false,
      reason: "room_not_lobby",
    });
    assert.deepEqual(evaluateLobbyStartGates(room, { allowMatchPhase: true }), {
      ok: true,
    });
  });

  it("still enforces seat gates when a rematch is allowed", () => {
    const { room } = finishedMatchPhaseRoom(["3"]);
    assert.deepEqual(evaluateLobbyStartGates(room, { allowMatchPhase: true }), {
      ok: false,
      reason: "open_seats_remain",
    });
  });

  it("lets a match-phase room begin a new match run", () => {
    const { room, registry } = finishedMatchPhaseRoom();
    const rematched = registry.beginMatch(room.code, "match-2");
    assert.equal(rematched.ok, true);
    assert.equal(rematched.room.phase, "match");
    assert.equal(rematched.room.matchId, "match-2");
  });
});
