import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./startServer.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(serverDir, "../../web/dist");

const started = await startServer({
  webRoot,
  openBrowser: true,
});

console.log(`COUP_READY ${started.url}`);

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
