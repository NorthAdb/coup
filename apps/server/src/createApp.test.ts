import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import type { CapabilityReport } from "./capabilityProbe.js";
import { createAgentRuntime } from "./agents/index.js";
import { createApp } from "./createApp.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-setup-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-app-db-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function readyReport(
  overrides?: Partial<CapabilityReport["clis"]>,
): CapabilityReport {
  return {
    clis: {
      opencode: {
        cli: "opencode",
        status: "ready",
        version: "1.18.10",
        models: [{ id: "openai/gpt-test", label: "openai/gpt-test" }],
        hint: "OpenCode 已就绪。",
        ...overrides?.opencode,
      },
      claude: {
        cli: "claude",
        status: "ready",
        version: "2.1.220",
        models: [{ id: "sonnet", label: "Sonnet（CLI 别名）" }],
        hint: "Claude Code 已就绪。",
        ...overrides?.claude,
      },
    },
  };
}

describe("match create API", () => {
  it("creates a configured multi-seat match", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      probe: async () => readyReport(),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/matches",
        payload: {
          seats: [
            {
              seatId: "seat-1",
              controller: "local_human",
              displayName: "你",
            },
            {
              seatId: "seat-2",
              controller: "stub_agent",
              displayName: "灰狐",
              cli: "opencode",
              modelId: "openai/gpt-test",
            },
            {
              seatId: "seat-3",
              controller: "stub_agent",
              displayName: "白塔",
              cli: "claude",
              modelId: "sonnet",
            },
          ],
        },
      });
      assert.equal(response.statusCode, 200);
      const body = response.json() as {
        view: {
          publicState: {
            seats: Array<{ displayName: string; controller: string }>;
          };
        };
      };
      assert.equal(body.view.publicState.seats.length, 3);
      assert.equal(body.view.publicState.seats[0]?.displayName, "你");
      assert.equal(body.view.publicState.seats[1]?.displayName, "灰狐");
      assert.equal(body.view.publicState.seats[2]?.displayName, "白塔");
    } finally {
      await app.close();
    }
  });

  it("rejects invalid setup with 400", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      probe: async () => readyReport(),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/matches",
        payload: {
          seats: [
            {
              seatId: "seat-1",
              controller: "stub_agent",
              displayName: "灰狐",
            },
            {
              seatId: "seat-2",
              controller: "local_human",
              displayName: "你",
            },
          ],
        },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(
        (response.json() as { error: string }).error,
        "first_seat_must_be_local_human",
      );
    } finally {
      await app.close();
    }
  });

  it("rejects start when a real CLI seat is not ready", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      probe: async () =>
        readyReport({
          opencode: {
            cli: "opencode",
            status: "not_authenticated",
            version: "1.18.10",
            models: [],
            hint: "OpenCode 尚未登录。请在终端完成对应 CLI 登录后点「重新检测」。",
          },
        }),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/matches",
        payload: {
          seats: [
            {
              seatId: "seat-1",
              controller: "local_human",
              displayName: "你",
            },
            {
              seatId: "seat-2",
              controller: "stub_agent",
              displayName: "灰狐",
              cli: "opencode",
              modelId: "openai/gpt-test",
            },
          ],
        },
      });
      assert.equal(response.statusCode, 400);
      const body = response.json() as { error: string; hint: string };
      assert.equal(body.error, "seat_not_ready:not_authenticated");
      assert.match(body.hint, /登录/);
    } finally {
      await app.close();
    }
  });
});

describe("match persistence API", () => {
  it("persists commands and restores the active match after app reopen", async () => {
    const dbPath = await tempDbPath();
    const webRoot = await tempWebRoot();
    const first = await createApp({
      webRoot,
      dbPath,
      probe: async () => readyReport(),
    });
    try {
      const created = await first.inject({
        method: "POST",
        url: "/api/matches",
        payload: {
          seats: [
            {
              seatId: "seat-1",
              controller: "local_human",
              displayName: "你",
            },
            {
              seatId: "seat-2",
              controller: "stub_agent",
              displayName: "灰狐",
              cli: "stub",
              modelId: "stub/placeholder",
            },
          ],
        },
      });
      assert.equal(created.statusCode, 200);
      const started = created.json() as {
        view: { matchId: string; stateVersion: number; requestId: string };
      };
      const decided = await first.inject({
        method: "POST",
        url: "/api/matches/current/decision",
        payload: {
          protocolVersion: 1,
          requestId: "req-persist-1",
          stateVersion: started.view.stateVersion,
          decision: { type: "declare_action", action: { type: "income" } },
        },
      });
      assert.equal(decided.statusCode, 200);
      const after = decided.json() as {
        view: { stateVersion: number; matchId: string };
      };
      assert.ok(after.view.stateVersion > started.view.stateVersion);
    } finally {
      await first.close();
    }

    const second = await createApp({
      webRoot,
      dbPath,
      probe: async () => readyReport(),
    });
    try {
      const current = await second.inject({
        method: "GET",
        url: "/api/matches/current",
      });
      assert.equal(current.statusCode, 200);
      const body = current.json() as {
        view: { stateVersion: number; matchId: string };
        matchId: string;
      };
      assert.ok(body.view.stateVersion > 1);
      assert.equal(body.matchId, body.view.matchId);

      const events = await second.inject({
        method: "GET",
        url: `/api/matches/${body.matchId}/events`,
      });
      assert.equal(events.statusCode, 200);
      const listed = events.json() as {
        events: Array<{ seq: number; event: { type: string } }>;
      };
      assert.ok(listed.events.length >= 2);
      assert.equal(listed.events[0]?.seq, 1);
    } finally {
      await second.close();
    }
  });

  it("records technical abort without a winner and resumes from snapshot", async () => {
    const dbPath = await tempDbPath();
    const webRoot = await tempWebRoot();
    let decideCalls = 0;
    const agentRuntime = createAgentRuntime({
      adapters: {
        opencode: {
          kind: "opencode",
          async decide(input) {
            decideCalls += 1;
            if (decideCalls === 1) {
              throw new Error("agent_decision_not_legal");
            }
            const decision = input.view.legalDecisions[0];
            if (!decision) {
              throw new Error("no_legal_decision");
            }
            return {
              protocolVersion: 1,
              requestId: input.view.requestId,
              stateVersion: input.view.stateVersion,
              decision,
            };
          },
        },
      },
    });

    const app = await createApp({
      webRoot,
      dbPath,
      agentRuntime,
      probe: async () => readyReport(),
    });
    let matchId = "";
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/matches",
        payload: {
          seats: [
            {
              seatId: "seat-1",
              controller: "local_human",
              displayName: "你",
            },
            {
              seatId: "seat-2",
              controller: "stub_agent",
              displayName: "灰狐",
              cli: "opencode",
              modelId: "openai/gpt-test",
            },
          ],
        },
      });
      assert.equal(created.statusCode, 200);
      const started = created.json() as {
        view: { matchId: string; stateVersion: number };
      };
      matchId = started.view.matchId;

      const decided = await app.inject({
        method: "POST",
        url: "/api/matches/current/decision",
        payload: {
          protocolVersion: 1,
          requestId: "req-abort-1",
          stateVersion: started.view.stateVersion,
          decision: { type: "declare_action", action: { type: "income" } },
        },
      });
      assert.equal(decided.statusCode, 502);
      const failed = decided.json() as {
        aborted: boolean;
        matchId: string;
        error: string;
      };
      assert.equal(failed.aborted, true);
      assert.equal(failed.matchId, matchId);

      const listed = await app.inject({ method: "GET", url: "/api/matches" });
      const matches = listed.json() as {
        matches: Array<{
          matchId: string;
          runStatus: string;
          winnerSeatId: string | null;
        }>;
      };
      const aborted = matches.matches.find((entry) => entry.matchId === matchId);
      assert.ok(aborted);
      assert.equal(aborted.runStatus, "technical_abort");
      assert.equal(aborted.winnerSeatId, null);

      const resumed = await app.inject({
        method: "POST",
        url: `/api/matches/${matchId}/resume`,
      });
      assert.equal(resumed.statusCode, 200);
      const body = resumed.json() as {
        view: { matchId: string };
        resumedFromMatchId: string;
      };
      assert.equal(body.resumedFromMatchId, matchId);
      assert.notEqual(body.view.matchId, matchId);
    } finally {
      await app.close();
    }
  });
});

describe("capabilities API", () => {
  it("returns sanitized capability report without secret fields", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      probe: async () => readyReport(),
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/capabilities",
      });
      assert.equal(response.statusCode, 200);
      const body = response.json() as CapabilityReport;
      assert.equal(body.clis.opencode.status, "ready");
      assert.equal(body.clis.claude.models[0]?.id, "sonnet");
      const blob = JSON.stringify(body);
      assert.equal(blob.includes("oauth_token"), false);
      assert.equal(blob.includes("auth.json"), false);
    } finally {
      await app.close();
    }
  });
});
