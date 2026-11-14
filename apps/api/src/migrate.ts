import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const DEFAULT_DIR = path.join(__dirname, "..", "migrations");
const LOCK_ID = 727_001; // arbitrary key for the advisory lock

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies the pending .sql files of a directory, in name order.
 * - every file runs in its own transaction, so a failure leaves no partial change
 * - an advisory lock keeps two processes from migrating at the same time
 */
export async function migrate(pool: Pool, dir: string = DEFAULT_DIR): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => r.name));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const file of files) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }

      const sql = await readFile(path.join(dir, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(file);
    }

    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
