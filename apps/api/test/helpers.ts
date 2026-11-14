import { Pool } from "pg";
import { migrate } from "../src/migrate";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/experiment_hub_test";

export function createTestPool(): Pool {
  return new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
}

/** Drops everything and leaves an empty public schema. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE");
  await pool.query("CREATE SCHEMA public");
}

export async function migratedDatabase(pool: Pool): Promise<void> {
  await resetDatabase(pool);
  await migrate(pool);
}

export async function insertExperiment(pool: Pool, key = "checkout-button"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO experiments (key, name) VALUES ($1, $2) RETURNING id",
    [key, `Experiment ${key}`],
  );
  return rows[0].id;
}

export async function insertVariant(
  pool: Pool,
  experimentId: string,
  key: string,
  isControl = false,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO variants (experiment_id, key, name, is_control) VALUES ($1, $2, $3, $4) RETURNING id",
    [experimentId, key, `Variant ${key}`, isControl],
  );
  return rows[0].id;
}
