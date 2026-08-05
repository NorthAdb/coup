import type { FastifyInstance } from "fastify";
import open from "open";
import { createApp } from "./createApp.js";

const LOOPBACK_HOST = "127.0.0.1";

export type StartServerOptions = {
  webRoot: string;
  openBrowser?: boolean;
  port?: number;
  dbPath?: string;
};

export type StartedServer = {
  app: FastifyInstance;
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
};

export async function startServer(
  options: StartServerOptions,
): Promise<StartedServer> {
  const app = await createApp({
    webRoot: options.webRoot,
    dbPath: options.dbPath,
  });

  await app.listen({ host: LOOPBACK_HOST, port: options.port ?? 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    await app.close();
    throw new Error("Server did not bind to a TCP address");
  }
  if (address.address !== LOOPBACK_HOST) {
    await app.close();
    throw new Error(`Refusing non-loopback bind: ${address.address}`);
  }
  const port = address.port;
  const url = `http://${LOOPBACK_HOST}:${port}/`;

  if (options.openBrowser !== false) {
    await open(url);
  }

  return {
    app,
    url,
    host: LOOPBACK_HOST,
    port,
    close: () => app.close(),
  };
}
