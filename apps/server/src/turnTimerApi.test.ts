import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createApp } from "./createApp.js";
import { GRACE_MS } from "./seatAbsence.js";
import { HEARTBEAT_LEASE_MS } from "./seatPresenceTracker.js";

const tempDirs: string[] = [];

after(async () => {
  const { rm } = await import("node:fs/promises");
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-timer-"));
  tempDirs.push(dir);
  return path.join(dir, "test.sqlite");
}

async function tempWebRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-web-"));
  tempDirs.push(dir);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(dir, "index.html"), "<html></html>");
  return dir;
}

const HOSTING = {
  getState: () =>
    ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
  ensureHostMode: async () =>
    ({ bindMode: "host" as const, listenHost: "0.0.0.0", port: 8787 }),
};

const IFACES = () => ({
  Ethernet: [{ address: "192.168.1.42", family: "IPv4" as const, internal: false }],
});

function cookieFrom(
  setCookie: string | string[] | undefined,
  name: string,
): string | null {
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
  csrfToken: string;
  /** 每次请求即时组装的头（含 cookie）。 */
  headers: Record<string, string>;
};

function sessionHeaders(
  session: Pick<Session, "origin" | "cookie" | "csrfToken">,
): Record<string, string> {
  return {
    origin: session.origin,
    cookie: session.cookie,
    "x-csrf-token": session.csrfToken,
  };
}

async function newSession(
  app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
): Promise<Session> {
  const sessionRes = await app.inject({
    method: "GET",
    url: "/api/session",
    headers: { origin },
  });
  assert.equal(sessionRes.statusCode, 200);
  const { csrfToken } = sessionRes.json() as { csrfToken: string };
  const sessionPair = cookieFrom(sessionRes.headers["set-cookie"], "coup_session");
  assert.ok(sessionPair);
  return {
    origin,
    cookie: sessionPair,
    csrfToken,
    headers: sessionHeaders({ origin, cookie: sessionPair, csrfToken }),
  };
}

async function setupTwoPlayerRoom(
  app: Awaited<ReturnType<typeof createApp>>,
  options: { turnTimeLimitSec?: number; start?: boolean } = {},
): Promise<{ code: string; host: Session; guest: Session }> {
  const host = await newSession(app, "http://192.168.1.42:8787");
  const guest = await newSession(app, "http://192.168.1.42:8787");
  const created = await app.inject({
    method: "POST",
    url: "/api/rooms",
    headers: host.headers,
  });
  assert.equal(created.statusCode, 200);
  const { code } = created.json() as { code: string };
  const hostSeat = cookieFrom(created.headers["set-cookie"], "coup_seat");
  assert.ok(hostSeat);
  host.cookie = `${host.cookie}; ${hostSeat}`;
  host.headers = sessionHeaders(host);

  const claimed = await app.inject({
    method: "POST",
    url: `/api/rooms/${code}/seats/2/claim`,
    headers: guest.headers,
    payload: { displayName: "Alice" },
  });
  assert.equal(claimed.statusCode, 200);
  const guestSeat = cookieFrom(claimed.headers["set-cookie"], "coup_seat");
  assert.ok(guestSeat);
  guest.cookie = `${guest.cookie}; ${guestSeat}`;
  guest.headers = sessionHeaders(guest);

  if (options.turnTimeLimitSec !== undefined) {
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/rooms/${code}/settings`,
      headers: host.headers,
      payload: { turnTimeLimitSec: options.turnTimeLimitSec },
    });
    assert.equal(patched.statusCode, 200);
  }

  for (const seatId of ["3", "4", "5", "6"]) {
    const closed = await app.inject({
      method: "PATCH",
      url: `/api/rooms/${code}/seats/${seatId}/config`,
      headers: host.headers,
      payload: { kind: "closed" },
    });
    assert.equal(closed.statusCode, 200);
  }

  if (options.start !== false) {
    const started = await app.inject({
      method: "POST",
      url: `/api/rooms/${code}/start`,
      headers: host.headers,
    });
    assert.equal(started.statusCode, 200);
  }
  return { code, host, guest };
}

describe("room settings", () => {
  it("host can update the turn time limit and it round-trips via room snapshot", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: HOSTING,
      listNetworkInterfaces: IFACES,
    });
    try {
      const { code, host } = await setupTwoPlayerRoom(app, { start: false });
      const patched = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${code}/settings`,
        headers: host.headers,
        payload: { turnTimeLimitSec: 90 },
      });
      assert.equal(patched.statusCode, 200);
      const patchedBody = patched.json() as { turnTimeLimitSec: number };
      assert.equal(patchedBody.turnTimeLimitSec, 90);

      const snapshot = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}`,
      });
      const body = snapshot.json() as { turnTimeLimitSec?: number };
      assert.equal(body.turnTimeLimitSec, 90);

      // 开局后设置锁定。
      const started = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/start`,
        headers: host.headers,
      });
      assert.equal(started.statusCode, 200);
      const locked = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${code}/settings`,
        headers: host.headers,
        payload: { turnTimeLimitSec: 30 },
      });
      assert.equal(locked.statusCode, 409);
    } finally {
      await app.close();
    }
  });

  it("rejects non-host and invalid values", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: HOSTING,
      listNetworkInterfaces: IFACES,
    });
    try {
      const { code, guest, host } = await setupTwoPlayerRoom(app);
      const forbidden = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${code}/settings`,
        headers: guest.headers,
        payload: { turnTimeLimitSec: 30 },
      });
      assert.equal(forbidden.statusCode, 403);

      // 有主机凭证但数值非法 → 400。
      const invalid = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${code}/settings`,
        headers: host.headers,
        payload: { turnTimeLimitSec: 9999 },
      });
      assert.equal(invalid.statusCode, 400);
    } finally {
      await app.close();
    }
  });
});

describe("turn deadline & auto decision", () => {
  it("exposes turnDeadline and auto-applies income on expiry", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: HOSTING,
      listNetworkInterfaces: IFACES,
    });
    try {
      const { code, host } = await setupTwoPlayerRoom(app, {
        turnTimeLimitSec: 1,
      });

      const first = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      assert.equal(first.statusCode, 200);
      const firstBody = first.json() as {
        view: { stateVersion: number; publicState: { currentSeatId: string } };
        turnDeadline: { seatId: string; durationMs: number } | null;
      };
      assert.notEqual(firstBody.turnDeadline, null);
      assert.equal(firstBody.turnDeadline?.seatId, "1");
      assert.equal(firstBody.turnDeadline?.durationMs, 1000);
      const seatIsHost = firstBody.view.publicState.currentSeatId === "1";

      // 等待超时自动收入（1 秒限时 + 调度余量）。
      await new Promise((resolve) => setTimeout(resolve, 1900));

      const after = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      const afterBody = after.json() as {
        view: {
          stateVersion: number;
          projectedHistory: Array<{ type: string; seatId?: string }>;
        };
        autoDecision: { seatId: string; kind: string } | null;
      };
      assert.equal(afterBody.view.stateVersion, firstBody.view.stateVersion + 1);
      const resolved = afterBody.view.projectedHistory.find(
        (event) => event.type === "action_resolved" && event.seatId === "1",
      );
      assert.notEqual(resolved, undefined);
      assert.equal(afterBody.autoDecision?.seatId, "1");
      assert.ok(
        afterBody.autoDecision?.kind === "income" ||
          afterBody.autoDecision?.kind === "forced_action",
      );
      assert.ok(seatIsHost);
    } finally {
      await app.close();
    }
  });

  it("does not arm a timer when the room is unlimited", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: HOSTING,
      listNetworkInterfaces: IFACES,
    });
    try {
      const { code, host } = await setupTwoPlayerRoom(app, {
        turnTimeLimitSec: 0,
      });
      const first = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      const body = first.json() as { turnDeadline: unknown };
      assert.equal(body.turnDeadline, null);
    } finally {
      await app.close();
    }
  });
});

describe("absence pause & resume", () => {
  it("re-arms the turn deadline after the deciding seat resumes from absence", async () => {
    let clock = 1_000_000;
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: HOSTING,
      listNetworkInterfaces: IFACES,
      now: () => clock,
    });
    try {
      const { code, host, guest } = await setupTwoPlayerRoom(app, {
        turnTimeLimitSec: 2,
      });

      // 房主宣布 steal 指向 2 号座位 → 响应窗口由客人（远程座位）欠决策。
      const first = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      assert.equal(first.statusCode, 200);
      const firstBody = first.json() as { view: { stateVersion: number } };
      const declared = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/matches/current/decision`,
        headers: {
          origin: "http://192.168.1.42:8787",
          cookie: host.cookie,
          "x-csrf-token": host.csrfToken,
          "content-type": "application/json",
        },
        payload: {
          protocolVersion: 1,
          requestId: "declare-steal",
          stateVersion: firstBody.view.stateVersion,
          decision: {
            type: "declare_action",
            action: { type: "steal", targetSeatId: "2" },
          },
        },
      });
      assert.equal(declared.statusCode, 200);
      const declaredBody = declared.json() as {
        turnDeadline: { seatId: string } | null;
      };
      assert.equal(declaredBody.turnDeadline?.seatId, "2");

      // 客人报一次心跳后失联：租约过期 → 重连宽限 → 离席（注入时钟推进）。
      const beat = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/heartbeat`,
        headers: {
          origin: "http://192.168.1.42:8787",
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
        },
      });
      assert.equal(beat.statusCode, 200);
      clock += HEARTBEAT_LEASE_MS + 1;
      clock += GRACE_MS + 1;
      const presence = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/presence`,
        headers: { origin: "http://192.168.1.42:8787", cookie: guest.cookie },
      });
      const absences = (presence.json() as {
        absences: Array<{ seatId: string; phase: string }>;
      }).absences;
      assert.equal(
        absences.find((a) => a.seatId === "2")?.phase,
        "absent",
      );

      // 离席暂停：真实计时器到点后应被拆除（turnDeadline 清空），对局不推进。
      await new Promise((resolve) => setTimeout(resolve, 2300));
      const whileAbsent = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      assert.equal(whileAbsent.statusCode, 200);
      assert.equal(
        (whileAbsent.json() as { turnDeadline: unknown }).turnDeadline,
        null,
      );

      // 回席：凭证轮换 + 计时器必须重新武装（否则该回合失去超时代打保护）。
      const resumed = await app.inject({
        method: "POST",
        url: `/api/rooms/${code}/resume-seat`,
        headers: {
          origin: "http://192.168.1.42:8787",
          cookie: guest.cookie,
          "x-csrf-token": guest.csrfToken,
        },
      });
      assert.equal(resumed.statusCode, 200);
      const rearmed = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      const rearmedBody = rearmed.json() as {
        turnDeadline: { seatId: string; durationMs: number } | null;
      };
      assert.equal(rearmedBody.turnDeadline?.seatId, "2");
      assert.equal(rearmedBody.turnDeadline?.durationMs, 2000);
    } finally {
      await app.close();
    }
  });
});

describe("incremental polling", () => {
  it("returns an unchanged payload when since matches the state version", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: HOSTING,
      listNetworkInterfaces: IFACES,
    });
    try {
      const { code, host } = await setupTwoPlayerRoom(app);
      const first = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      const viewBody = first.json() as { view: { stateVersion: number } };
      const currentVersion = viewBody.view.stateVersion;

      const polled = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current?since=${currentVersion}`,
        headers: { origin: "http://192.168.1.42:8787", cookie: host.cookie },
      });
      assert.equal(polled.statusCode, 200);
      const body = polled.json() as { unchanged: boolean; stateVersion: number; view?: unknown };
      assert.equal(body.unchanged, true);
      assert.equal(body.stateVersion, currentVersion);
      assert.equal(body.view, undefined);
    } finally {
      await app.close();
    }
  });
});

describe("spectator projection", () => {
  it("serves a stripped read-only view without a seat credential", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: HOSTING,
      listNetworkInterfaces: IFACES,
    });
    try {
      const { code } = await setupTwoPlayerRoom(app);
      const response = await app.inject({
        method: "GET",
        url: `/api/rooms/${code}/matches/current?spectate=1`,
      });
      assert.equal(response.statusCode, 200);
      const body = response.json() as {
        view: {
          spectator?: boolean;
          seatId: string;
          privateState: { hiddenCharacters: string[] };
          legalDecisions: unknown[];
          publicState: { seats: unknown[] };
        };
      };
      assert.equal(body.view.spectator, true);
      assert.equal(body.view.seatId, "spectator");
      assert.deepEqual(body.view.privateState.hiddenCharacters, []);
      assert.deepEqual(body.view.legalDecisions, []);
      assert.ok(Array.isArray(body.view.publicState.seats));
    } finally {
      await app.close();
    }
  });
});
