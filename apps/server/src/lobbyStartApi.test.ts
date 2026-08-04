import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";

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
  it("lets the host set remaining seats to open, local_agent, or closed", async () => {
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
      assert.equal(agentSeat.statusCode, 200);
      const agentBody = agentSeat.json() as { seats: LobbySeat[] };
      const seat4 = agentBody.seats.find((s) => s.seatId === "4");
      assert.equal(seat4?.kind, "local_agent");
      assert.equal(seat4?.displayName, "灰狐");
      assert.equal(seat4?.cli, "stub");
      assert.equal(seat4?.modelId, "stub/placeholder");

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
  it("blocks start while open seats remain and allows host+agent without remotes", async () => {
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

      await configureSeat(app, host, cookie, code, "4", {
        kind: "local_agent",
        displayName: "灰狐",
        cli: "stub",
        modelId: "stub/placeholder",
      });
      for (const seatId of ["3", "5", "6"]) {
        await configureSeat(app, host, cookie, code, seatId, {
          kind: "closed",
        });
      }
      // Seat 2 still open — start must fail.

      const blocked = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/start`,
        headers: {
          origin: host.origin,
          cookie,
          "x-csrf-token": host.csrfToken,
        },
      });
      assert.equal(blocked.statusCode, 400);
      assert.equal(
        (blocked.json() as { error: string }).error,
        "open_seats_remain",
      );

      await configureSeat(app, host, cookie, code, "2", { kind: "closed" });

      const guest = await openSession(app, "http://192.168.1.42:8787");
      const guestStart = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/start`,
        headers: {
          origin: guest.origin,
          cookie: guest.cookie,
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
        url: "/api/matches/current",
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
      // Private hands must differ across seats.
      assert.notDeepEqual(
        guestView.view.privateState.hiddenCharacters,
        hostStart.view.privateState.hiddenCharacters,
      );

      // Seat 1 acts first in a fresh two-human match.
      assert.ok(hostStart.view.legalDecisions.length > 0);
      const income = hostStart.view.legalDecisions.find(
        (d) => d.type === "declare_action",
      );
      assert.ok(income);

      const guestForbidden = await app.inject({
        method: "POST",
        url: "/api/matches/current/decision",
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
        url: "/api/matches/current/decision",
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
