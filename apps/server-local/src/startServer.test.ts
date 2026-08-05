import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { startServer } from "./startServer.js";

async function tempWebRoot() {
  const webRoot = await mkdtemp(path.join(tmpdir(), "coup-local-"));
  await writeFile(
    path.join(webRoot, "index.html"),
    "<!doctype html><html><body><h1>政变</h1><p>本机版</p></body></html>",
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
      assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      const response = await fetch(started.url);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /本机版/);
    } finally {
      await started.close();
    }
  });

  it("binds to the requested port when provided", async () => {
    const webRoot = await tempWebRoot();
    const started = await startServer({
      webRoot,
      openBrowser: false,
      port: 0,
      dbPath: path.join(webRoot, "coup.sqlite"),
    });
    try {
      assert.ok(started.port > 0);
      const response = await fetch(started.url);
      assert.equal(response.status, 200);
    } finally {
      await started.close();
    }
  });
});
