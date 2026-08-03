import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { CapabilityReport } from "./capabilityProbe.js";
import { createApp } from "./createApp.js";

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-setup-"));
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

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

describe("capabilities API", () => {
  it("returns sanitized capability report without secret fields", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
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
