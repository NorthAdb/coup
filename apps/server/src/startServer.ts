import type { FastifyInstance } from "fastify";
import open from "open";
import {
  createApp,
  type BindMode,
  type HostingController,
} from "./createApp.js";

const LOOPBACK_HOST = "127.0.0.1";
const ALL_INTERFACES_HOST = "0.0.0.0";
export const DEFAULT_HOST_PORT = 8787;

export type { BindMode };

export type StartServerOptions = {
  webRoot: string;
  openBrowser?: boolean;
  port?: number;
  dbPath?: string;
  bindMode?: BindMode;
  /** Host mode preferred port (default 8787). Falls back to OS ephemeral on EADDRINUSE. */
  preferredPort?: number;
};

export type StartedServer = {
  app: FastifyInstance;
  url: string;
  /** Address shown for local browser open / loopback fetch. */
  host: string;
  /** Actual listen host (127.0.0.1 or 0.0.0.0). */
  listenHost: string;
  port: number;
  bindMode: BindMode;
  close: () => Promise<void>;
};

function isAddrInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "EADDRINUSE"
  );
}

async function closeListener(app: FastifyInstance): Promise<void> {
  const server = app.server;
  if (!server.listening) return;
  // Drop idle keep-alive connections so server.close() completes promptly
  // instead of waiting for the keep-alive timeout (~5s).
  server.closeIdleConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Listen on the underlying Node server directly.
 * Fastify's app.listen() refuses a second call on the same instance
 * (FST_ERR_REOPENED_SERVER) once it has listened once, so runtime rebinds
 * (loopback -> 0.0.0.0 for host mode) must go through the raw server.
 */
function rawListen(
  server: FastifyInstance["server"],
  host: string,
  port: number,
): Promise<{ listenHost: string; port: number }> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP address"));
        return;
      }
      resolve({ listenHost: address.address, port: address.port });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port });
  });
}

async function rebindApp(
  app: FastifyInstance,
  host: string,
  port: number,
): Promise<{ listenHost: string; port: number }> {
  await closeListener(app);
  return rawListen(app.server, host, port);
}

async function listenApp(
  app: FastifyInstance,
  bindMode: BindMode,
  port: number,
): Promise<{ listenHost: string; port: number }> {
  if (bindMode === "local") {
    await app.listen({ host: LOOPBACK_HOST, port });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      await app.close();
      throw new Error("Server did not bind to a TCP address");
    }
    if (address.address !== LOOPBACK_HOST) {
      await app.close();
      throw new Error(`Refusing non-loopback bind: ${address.address}`);
    }
    return { listenHost: LOOPBACK_HOST, port: address.port };
  }

  try {
    await app.listen({ host: ALL_INTERFACES_HOST, port });
  } catch (error) {
    if (port !== 0 && isAddrInUse(error)) {
      await app.listen({ host: ALL_INTERFACES_HOST, port: 0 });
    } else {
      throw error;
    }
  }

  const address = app.server.address();
  if (!address || typeof address === "string") {
    await app.close();
    throw new Error("Server did not bind to a TCP address");
  }
  return { listenHost: ALL_INTERFACES_HOST, port: address.port };
}

export async function startServer(
  options: StartServerOptions,
): Promise<StartedServer> {
  let bindMode: BindMode = options.bindMode ?? "local";
  let listenHost = LOOPBACK_HOST;
  let port = 0;
  const preferredHostPort = options.preferredPort ?? DEFAULT_HOST_PORT;

  let appRef: FastifyInstance | null = null;

  const hosting: HostingController = {
    getState: () => ({ bindMode, listenHost, port }),
    async ensureHostMode() {
      if (bindMode === "host") {
        return { bindMode: "host", listenHost, port };
      }
      const app = appRef;
      if (!app) throw new Error("hosting_unavailable");
      try {
        const bound = await rebindApp(app, ALL_INTERFACES_HOST, preferredHostPort);
        bindMode = "host";
        listenHost = bound.listenHost;
        port = bound.port;
        return { bindMode: "host", listenHost, port };
      } catch (error) {
        const bound = await rebindApp(app, LOOPBACK_HOST, 0);
        bindMode = "local";
        listenHost = bound.listenHost;
        port = bound.port;
        throw error;
      }
    },
  };

  const app = await createApp({
    webRoot: options.webRoot,
    dbPath: options.dbPath,
    hosting,
  });
  appRef = app;

  const preferred =
    options.port ?? (bindMode === "host" ? preferredHostPort : 0);

  const bound = await listenApp(app, bindMode, preferred);
  listenHost = bound.listenHost;
  port = bound.port;
  const url = `http://${LOOPBACK_HOST}:${port}/`;

  if (options.openBrowser !== false) {
    await open(url);
  }

  return {
    app,
    url,
    host: LOOPBACK_HOST,
    listenHost,
    port,
    bindMode,
    close: () => app.close(),
  };
}
