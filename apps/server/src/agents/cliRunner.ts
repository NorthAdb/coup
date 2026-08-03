import { spawn } from "node:child_process";
import type { CliRunRequest, CliRunResult, CliRunner } from "./types.js";

/**
 * Spawn a CLI with an argv array. On Windows, `shell: true` is required so
 * npm `.cmd` shims resolve; arguments are never concatenated into a shell
 * string.
 */
export function createProcessCliRunner(): CliRunner {
  return (request: CliRunRequest) =>
    new Promise<CliRunResult>((resolve, reject) => {
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env ? { ...process.env, ...request.env } : process.env,
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      if (request.stdin != null) {
        child.stdin.end(request.stdin, "utf8");
      } else {
        child.stdin.end();
      }
    });
}
