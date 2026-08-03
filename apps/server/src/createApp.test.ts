import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createApp } from "./createApp.js";

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-setup-"));
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

describe("match create API", () => {
  it("creates a configured multi-seat match", async () => {
    const app = await createApp({ webRoot: await tempWebRoot() });
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
              modelId: "opencode/placeholder",
            },
            {
              seatId: "seat-3",
              controller: "stub_agent",
              displayName: "白塔",
              cli: "claude",
              modelId: "claude/placeholder",
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
    const app = await createApp({ webRoot: await tempWebRoot() });
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
});
