import { loadConfig, loadDotEnv } from "./config";
import { createPool } from "./db";
import { migrate } from "./migrate";

async function main() {
  loadDotEnv();
  const pool = createPool(loadConfig().DATABASE_URL);
  try {
    const { applied, skipped } = await migrate(pool);
    console.log(`Applied ${applied.length} migration(s), skipped ${skipped.length}.`);
    for (const name of applied) console.log(`  + ${name}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
