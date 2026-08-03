import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createProcessCliRunner } from "./cliRunner.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("createProcessCliRunner abort", () => {
  it(
    "rejects and kills the spawned process tree when abortSignal fires",
    { timeout: 8_000 },
    async () => {
      const stamp = `${process.pid}-${Date.now()}`;
      const marker = path.join(tmpdir(), `coup-cli-abort-${stamp}.pid`);
      const scriptPath = path.join(tmpdir(), `coup-cli-abort-${stamp}.mjs`);
      writeFileSync(
        scriptPath,
        [
          "import { writeFileSync } from 'node:fs';",
          `writeFileSync(${JSON.stringify(marker)}, String(process.pid));`,
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
        "utf8",
      );

      const controller = new AbortController();
      const runner = createProcessCliRunner();
      // Prefer PATH `node` over process.execPath: on Windows, shell:true
      // splits "C:\\Program Files\\..." and fails to launch.
      const run = runner({
        command: "node",
        args: [scriptPath],
        cwd: process.cwd(),
        abortSignal: controller.signal,
      });

      let childPid = 0;
      for (let i = 0; i < 80; i += 1) {
        if (existsSync(marker)) {
          childPid = Number(readFileSync(marker, "utf8"));
          if (Number.isFinite(childPid) && childPid > 0) break;
        }
        await delay(50);
      }
      assert.ok(childPid > 0, "child should write its pid marker");
      assert.equal(isPidAlive(childPid), true);

      controller.abort();

      await assert.rejects(run, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "agent_timeout");
        return true;
      });

      for (let i = 0; i < 40; i += 1) {
        if (!isPidAlive(childPid)) break;
        await delay(50);
      }
      assert.equal(
        isPidAlive(childPid),
        false,
        "aborted CLI child (and tree) must not keep running",
      );

      for (const file of [marker, scriptPath]) {
        try {
          unlinkSync(file);
        } catch {
          /* ignore */
        }
      }
    },
  );
});
