import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { startServer } from "./startServer.js";

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-web-"));
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body><h1>政变</h1><p>本地启动壳已就绪</p></body></html>",
  );
  return webRoot;
}

describe("local launch shell", () => {
  it("binds only to 127.0.0.1 and serves the placeholder page", async () => {
    const webRoot = await tempWebRoot();

    const started = await startServer({
      webRoot,
      openBrowser: false,
      dbPath: path.join(webRoot, "coup.sqlite"),
    });

    try {
      assert.equal(started.host, "127.0.0.1");
      assert.equal(started.bindMode, "local");
      assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

      const response = await fetch(started.url);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /政变/);
      assert.match(body, /本地启动壳已就绪/);
    } finally {
      await started.close();
    }
  });

  it("host mode binds 0.0.0.0 and prefers port 8787 when free", async () => {
    const webRoot = await tempWebRoot();

    const started = await startServer({
      webRoot,
      openBrowser: false,
      dbPath: path.join(webRoot, "coup.sqlite"),
      bindMode: "host",
      preferredPort: 8787,
    });

    try {
      assert.equal(started.bindMode, "host");
      assert.equal(started.listenHost, "0.0.0.0");
      assert.equal(started.port, 8787);
      assert.match(started.url, /^http:\/\/127\.0\.0\.1:8787\/$/);

      const response = await fetch(started.url);
      assert.equal(response.status, 200);
    } finally {
      await started.close();
    }
  });

  it("host mode falls back when preferred port is busy", async () => {
    const webRoot = await tempWebRoot();
    const blocker = await startServer({
      webRoot,
      openBrowser: false,
      dbPath: path.join(webRoot, "coup-a.sqlite"),
      bindMode: "host",
      preferredPort: 8791,
    });

    try {
      const started = await startServer({
        webRoot,
        openBrowser: false,
        dbPath: path.join(webRoot, "coup-b.sqlite"),
        bindMode: "host",
        preferredPort: 8791,
      });
      try {
        assert.equal(started.bindMode, "host");
        assert.equal(started.listenHost, "0.0.0.0");
        assert.notEqual(started.port, 8791);
        assert.ok(started.port > 0);
      } finally {
        await started.close();
      }
    } finally {
      await blocker.close();
    }
  });

  it("runtime rebind via /api/hosting/enter keeps the server listening on 0.0.0.0", async () => {
    const webRoot = await tempWebRoot();
    const started = await startServer({
      webRoot,
      openBrowser: false,
      dbPath: path.join(webRoot, "coup.sqlite"),
      preferredPort: 8793,
    });

    try {
      assert.equal(started.bindMode, "local");
      const probe = await fetch(`${started.url}api/hosting`, {
        headers: { origin: "http://192.168.1.7:8787" },
      });
      assert.equal(probe.headers.get("access-control-allow-origin"), "*");

      const response = await fetch(`${started.url}api/hosting/enter`, {
        method: "POST",
      });
      const body = (await response.json()) as { status: string };
      assert.equal(body.status, "rebinding");

      let address: ReturnType<typeof started.app.server.address> = null;
      for (let i = 0; i < 60; i++) {
        address = started.app.server.address();
        if (address && typeof address !== "string") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(address && typeof address !== "string");
      assert.equal(address.address, "0.0.0.0");
      assert.equal(address.port, 8793);

      const live = await fetch("http://127.0.0.1:8793/api/hosting");
      assert.equal(live.status, 200);
    } finally {
      await started.close();
    }
  });
});
