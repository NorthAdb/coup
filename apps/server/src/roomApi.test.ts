import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createApp } from "./createApp.js";

const tempDirs: string[] = [];

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-room-"));
  tempDirs.push(webRoot);
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body>ok</body></html>",
  );
  return webRoot;
}

async function tempDbPath() {
  const dir = await mkdtemp(path.join(tmpdir(), "coup-room-db-"));
  tempDirs.push(dir);
  return path.join(dir, "coup.sqlite");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

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

async function authedHeaders(
  app: Awaited<ReturnType<typeof createApp>>,
  origin: string,
) {
  const session = await app.inject({
    method: "GET",
    url: "/api/session",
    headers: { origin },
  });
  assert.equal(session.statusCode, 200);
  const csrfToken = (session.json() as { csrfToken: string }).csrfToken;
  const cookie = cookieFrom(session.headers["set-cookie"], "coup_session");
  assert.ok(cookie);
  return {
    origin,
    cookie,
    "x-csrf-token": csrfToken,
  };
}

describe("room invite API", () => {
  it("creates a room in host mode and returns join url", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [
          { address: "192.168.1.42", family: "IPv4", internal: false },
        ],
        lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://192.168.1.42:8787");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      assert.equal(created.statusCode, 200);
      const body = created.json() as {
        code: string;
        joinUrl: string;
        selectedHost: string;
        port: number;
        bindMode: string;
        lanOrigin: string;
      };
      assert.match(body.code, /^\d{4}$/);
      assert.equal(body.port, 8787);
      assert.equal(body.bindMode, "host");
      assert.equal(body.selectedHost, "192.168.1.42");
      assert.equal(
        body.joinUrl,
        `http://192.168.1.42:8787/join?code=${body.code}`,
      );
      assert.equal(body.lanOrigin, "http://192.168.1.42:8787");

      const lookup = await app.inject({
        method: "GET",
        url: `/api/rooms/${body.code}`,
      });
      assert.equal(lookup.statusCode, 200);
      assert.equal((lookup.json() as { code: string }).code, body.code);

      const missing = await app.inject({
        method: "GET",
        url: "/api/rooms/0001",
      });
      assert.equal(missing.statusCode, 404);
    } finally {
      await app.close();
    }
  });

  it("returns need_host_mode when still on loopback", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "local",
          listenHost: "127.0.0.1",
          port: 3456,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [
          { address: "192.168.1.42", family: "IPv4", internal: false },
        ],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://127.0.0.1:3456");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      assert.equal(created.statusCode, 409);
      assert.equal(
        (created.json() as { error: string }).error,
        "need_host_mode",
      );
    } finally {
      await app.close();
    }
  });

  it("rejects create when no lan ipv4 is available", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://127.0.0.1:8787");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      assert.equal(created.statusCode, 400);
      assert.equal((created.json() as { error: string }).error, "no_lan_ipv4");
    } finally {
      await app.close();
    }
  });

  it("PATCH selected host refreshes join url", async () => {
    const app = await createApp({
      webRoot: await tempWebRoot(),
      dbPath: await tempDbPath(),
      hosting: {
        getState: () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
        ensureHostMode: async () => ({
          bindMode: "host",
          listenHost: "0.0.0.0",
          port: 8787,
        }),
      },
      listNetworkInterfaces: () => ({
        Ethernet: [
          { address: "192.168.1.42", family: "IPv4", internal: false },
        ],
        "Wi-Fi": [{ address: "10.0.0.8", family: "IPv4", internal: false }],
      }),
    });

    try {
      const headers = await authedHeaders(app, "http://192.168.1.42:8787");
      const created = await app.inject({
        method: "POST",
        url: "/api/rooms",
        headers,
      });
      const room = created.json() as { code: string };
      const patched = await app.inject({
        method: "PATCH",
        url: `/api/rooms/${room.code}`,
        payload: { selectedHost: "10.0.0.8" },
      });
      assert.equal(patched.statusCode, 200);
      const body = patched.json() as { joinUrl: string; selectedHost: string };
      assert.equal(body.selectedHost, "10.0.0.8");
      assert.equal(
        body.joinUrl,
        `http://10.0.0.8:8787/join?code=${room.code}`,
      );
    } finally {
      await app.close();
    }
  });
});
