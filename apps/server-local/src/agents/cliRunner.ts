import { spawn, type ChildProcess } from "node:child_process";
import type { CliRunRequest, CliRunResult, CliRunner } from "./types.js";

/**
 * Kill the spawned CLI and any descendants. Required on Windows where
 * `shell: true` wraps the real process in `cmd.exe`.
 */
export function killCliProcessTree(child: ChildProcess): void {
  if (child.pid == null) {
    return;
  }
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGKILL");
}

/**
 * Spawn a CLI with an argv array. On Windows, `shell: true` is required so
 * npm `.cmd` shims resolve; arguments are never concatenated into a shell
 * string.
 */
export function createProcessCliRunner(): CliRunner {
  return (request: CliRunRequest) =>
    new Promise<CliRunResult>((resolve, reject) => {
      if (request.abortSignal?.aborted) {
        reject(new Error("agent_timeout"));
        return;
      }

      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        request.abortSignal?.removeEventListener("abort", onAbort);
        finish();
      };

      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env ? { ...process.env, ...request.env } : process.env,
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const onAbort = () => {
        killCliProcessTree(child);
        settle(() => reject(new Error("agent_timeout")));
      };
      request.abortSignal?.addEventListener("abort", onAbort);

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
      child.on("error", (error) => {
        settle(() => reject(error));
      });
      child.on("close", (code) => {
        settle(() =>
          resolve({
            stdout,
            stderr,
            exitCode: code ?? 1,
          }),
        );
      });

      if (request.stdin != null) {
        child.stdin.end(request.stdin, "utf8");
      } else {
        child.stdin.end();
      }
    });
}
