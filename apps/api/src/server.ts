import { buildApp } from "./app";
import { loadConfig, loadDotEnv } from "./config";
import { createPool } from "./db";

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const app = buildApp({ pool, logger: true });

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
