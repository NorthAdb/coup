import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-rematch-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-rematch-db-"));
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

type MatchCtx = {
  app: Awaited<ReturnType<typeof createApp>>;
  host: SessionClient;
  guest: SessionClient;
  code: string;
  hostCookie: string;
  guestCookie: string;
};

async function startHostGuestMatch(
  app: Awaited<ReturnType<typeof createApp>>,
): Promise<MatchCtx> {
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

  return { app, host, guest, code, hostCookie, guestCookie };
}

type Decision =
  | { type: "declare_action"; action: { type: "income" } }
  | { type: "declare_action"; action: { type: "coup"; targetSeatId: string } }
  | { type: "choose_influence_to_reveal"; cardId: string };

type SeatViewLike = {
  seatId: string;
  stateVersion: number;
  publicState: { status: string; currentSeatId: string | null; phase: string };
  legalDecisions: Array<{
    type: string;
    action?: { type: string; targetSeatId?: string };
    cardId?: string;
  }>;
};

async function fetchViewAs(
  ctx: MatchCtx,
  client: SessionClient,
  cookie: string,
): Promise<SeatViewLike> {
  const response = await ctx.app.inject({
    method: "GET",
    url: "/api/matches/current",
    headers: { origin: client.origin, cookie },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { view: SeatViewLike };
  return body.view;
}

async function postDecision(
  ctx: MatchCtx,
  client: SessionClient,
  cookie: string,
  view: SeatViewLike,
  decision: Decision,
): Promise<void> {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/api/matches/current/decision",
    headers: {
      origin: client.origin,
      cookie,
      "x-csrf-token": client.csrfToken,
      "content-type": "application/json",
    },
    payload: {
      protocolVersion: 1,
      requestId: `req-${view.stateVersion}`,
      stateVersion: view.stateVersion,
      decision,
    },
  });
  assert.equal(response.statusCode, 200);
}

function pickDecision(
  view: SeatViewLike,
): Decision | null {
  const decisions = view.legalDecisions;
  if (decisions.length === 0) return null;
  const reveal = decisions.find((d) => d.type === "choose_influence_to_reveal");
  if (reveal && reveal.cardId) {
    return { type: "choose_influence_to_reveal", cardId: reveal.cardId };
  }
  const income = decisions.find(
    (d) => d.type === "declare_action" && d.action?.type === "income",
  );
  if (income) return { type: "declare_action", action: { type: "income" } };
  const coup = decisions.find(
    (d) =>
      d.type === "declare_action" &&
      d.action?.type === "coup" &&
      d.action.targetSeatId,
  );
  if (coup && coup.action?.targetSeatId) {
    return {
      type: "declare_action",
      action: { type: "coup", targetSeatId: coup.action.targetSeatId },
    };
  }
  const pass = decisions.find(
    (d) =>
      d.type === "pass_block" ||
      d.type === "pass_challenge" ||
      d.type === "concede_claim",
  );
  if (pass) {
    return { type: "declare_action", action: { type: "income" } };
  }
  return null;
}

/** 两个真人轮流出招（收入/强制政变/揭示），直到对局终局。 */
async function playToFinish(ctx: MatchCtx): Promise<void> {
  for (let guard = 0; guard < 200; guard += 1) {
    let anyDecision = false;
    for (const [client, cookie] of [
      [ctx.host, ctx.hostCookie],
      [ctx.guest, ctx.guestCookie],
    ] as Array<[SessionClient, string]>) {
      const view = await fetchViewAs(ctx, client, cookie);
      if (view.publicState.status === "finished") return;
      if (
        view.publicState.currentSeatId !== view.seatId &&
        view.legalDecisions.length === 0
      ) {
        continue;
      }
      const decision = pickDecision(view);
      if (!decision) continue;
      await postDecision(ctx, client, cookie, view, decision);
      anyDecision = true;
    }
    if (!anyDecision) {
      throw new Error("match stuck: no seat can decide");
    }
  }
  throw new Error("match did not finish within budget");
}

describe("rematch consent flow", () => {
  it("finish keeps guest credential; rematch waits for consent before starting", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });
    const ctx = await startHostGuestMatch(app);

    try {
      await playToFinish(ctx);

      // 终局后凭证保留（Q5-A）：客人仍被认出是座位 2。
      const meAfterFinish = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      const meAfterBody = meAfterFinish.json() as {
        seat: { seatId: string } | null;
      };
      assert.equal(meAfterBody.seat?.seatId, "2");

      const entered = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/rematch`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
        },
      });
      assert.equal(entered.statusCode, 200);
      const body = entered.json() as {
        phase: string;
        seats: Array<{
          seatId: string;
          kind: string;
          rematchStatus: string | null;
        }>;
      };
      assert.equal(body.phase, "rematch");
      const seat2 = body.seats.find((s) => s.seatId === "2");
      assert.equal(seat2?.rematchStatus, "awaiting");

      // Start is blocked until all seats confirm.
      const blocked = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/start`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
        },
      });
      assert.equal(blocked.statusCode, 400);
      assert.equal(
        (blocked.json() as { error: string }).error,
        "seats_not_confirmed",
      );

      // Guest joins the rematch: confirmed + credential rotated.
      const joined = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/rematch/join`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      assert.equal(joined.statusCode, 200);
      const joinBody = joined.json() as {
        seat: { seatId: string; rematchStatus: string | null };
      };
      assert.equal(joinBody.seat.seatId, "2");
      assert.equal(joinBody.seat.rematchStatus, "confirmed");
      const rotatedCookie = cookieFrom(joined.headers["set-cookie"], "coup_seat");
      assert.ok(rotatedCookie);
      const guestNewCookie = `${ctx.guest.cookie}; ${rotatedCookie}`;

      // Start now works; new match run is created.
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
      const startBody = started.json() as { matchId: string; phase: string };
      assert.equal(startBody.phase, "match");
      assert.ok(startBody.matchId);

      // Guest re-attaches with the rotated credential.
      const current = await app.inject({
        method: "GET",
        url: "/api/matches/current",
        headers: { origin: ctx.guest.origin, cookie: guestNewCookie },
      });
      assert.equal(current.statusCode, 200);
      const currentBody = current.json() as { view: { seatId: string } };
      assert.equal(currentBody.view.seatId, "2");
    } finally {
      await app.close();
    }
  });

  it("turns a leaving seat open; start then waits for the slot to be handled", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });
    const ctx = await startHostGuestMatch(app);

    try {
      await playToFinish(ctx);
      await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/rematch`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
        },
      });

      const left = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/rematch/leave`,
        headers: {
          origin: ctx.guest.origin,
          cookie: ctx.guestCookie,
          "x-csrf-token": ctx.guest.csrfToken,
        },
      });
      assert.equal(left.statusCode, 200);
      const leftBody = left.json() as {
        seats: Array<{
          seatId: string;
          kind: string;
          rematchStatus: string | null;
        }>;
      };
      const seat2 = leftBody.seats.find((s) => s.seatId === "2");
      assert.equal(seat2?.kind, "open");
      assert.equal(seat2?.rematchStatus, "left");

      // Old credential is void.
      const me = await app.inject({
        method: "GET",
        url: `/api/rooms/${ctx.code}/me`,
        headers: { origin: ctx.guest.origin, cookie: ctx.guestCookie },
      });
      assert.equal((me.json() as { seat: unknown }).seat, null);

      // Start blocked while the seat is open.
      const blocked = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/start`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
        },
      });
      assert.equal(blocked.statusCode, 400);
      assert.equal(
        (blocked.json() as { error: string }).error,
        "open_seats_remain",
      );

      // A new player claims the open seat during rematch → treated as confirmed.
      const newcomer = await openSession(app, "http://192.168.1.42:8787");
      const claimed = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/seats/2/claim`,
        headers: {
          origin: newcomer.origin,
          cookie: newcomer.cookie,
          "x-csrf-token": newcomer.csrfToken,
          "content-type": "application/json",
        },
        payload: { displayName: "新人" },
      });
      assert.equal(claimed.statusCode, 200);
      const claimedBody = claimed.json() as {
        seat: { rematchStatus: string | null };
      };
      assert.equal(claimedBody.seat.rematchStatus, "confirmed");

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
    } finally {
      await app.close();
    }
  });

  it("rejects entering rematch while the current run is still in progress", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      ...hostAppOptions(),
    });
    const ctx = await startHostGuestMatch(app);

    try {
      const entered = await app.inject({
        method: "POST",
        url: `/api/rooms/${ctx.code}/rematch`,
        headers: {
          origin: ctx.host.origin,
          cookie: ctx.hostCookie,
          "x-csrf-token": ctx.host.csrfToken,
        },
      });
      assert.equal(entered.statusCode, 409);
      assert.equal(
        (entered.json() as { error: string }).error,
        "match_in_progress",
      );
    } finally {
      await app.close();
    }
  });
});
