import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { startServer } from "./startServer.js";

describe("local launch shell", () => {
  it("binds only to 127.0.0.1 and serves the placeholder page", async () => {
    const webRoot = await mkdtemp(path.join(tmpdir(), "coup-web-"));
    await writeFile(
      path.join(webRoot, "index.html"),
      "<!doctype html><html><body><h1>政变</h1><p>本地启动壳已就绪</p></body></html>",
    );

    const started = await startServer({
      webRoot,
      openBrowser: false,
    });

    try {
      assert.equal(started.host, "127.0.0.1");
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
});
