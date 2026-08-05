import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { startServer } from "./startServer.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(serverDir, "../../web-local/dist");
const dbPath =
  process.env.COUP_DB_PATH ?? path.join(homedir(), ".coup", "coup.sqlite");

const started = await startServer({
  webRoot,
  openBrowser: process.env.COUP_OPEN_BROWSER !== "0",
  port: process.env.COUP_PORT ? Number(process.env.COUP_PORT) : undefined,
  dbPath,
});

console.log(`COUP_READY ${started.url}`);
console.log(`COUP_DB ${dbPath}`);

const shutdown = async () => {
  await started.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
