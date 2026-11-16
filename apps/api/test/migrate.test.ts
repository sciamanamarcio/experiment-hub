import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/migrate";
import { createTestPool, resetDatabase } from "./helpers";

// The real migration files, so this test keeps working as new migrations are added
async function realMigrationFiles(): Promise<string[]> {
  const files = await readdir(path.join(__dirname, "..", "migrations"));
  return files.filter((f) => f.endsWith(".sql")).sort();
}

describe("migrate", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(() => resetDatabase(pool));
  afterAll(() => pool.end());

  async function tableNames(): Promise<string[]> {
    const { rows } = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    return rows.map((r) => r.table_name);
  }

  it("creates the schema on an empty database", async () => {
    const result = await migrate(pool);

    expect(result.applied).toEqual(await realMigrationFiles());
    expect(await tableNames()).toEqual(
      expect.arrayContaining([
        "events",
        "exposures",
        "experiments",
        "feature_flag_overrides",
        "feature_flags",
        "schema_migrations",
        "variants",
      ]),
    );
  });

  it("is idempotent: a second run applies nothing", async () => {
    await migrate(pool);

    const second = await migrate(pool);

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(await realMigrationFiles());
  });

  it("rolls back a failing migration and keeps the previous ones", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "migrations-"));
    try {
      await writeFile(path.join(dir, "001_ok.sql"), "CREATE TABLE good (id int);");
      await writeFile(
        path.join(dir, "002_bad.sql"),
        "CREATE TABLE half_done (id int); SELECT * FROM table_that_does_not_exist;",
      );

      await expect(migrate(pool, dir)).rejects.toThrow(/002_bad\.sql/);

      const tables = await tableNames();
      expect(tables).toContain("good");
      expect(tables).not.toContain("half_done");

      const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
      expect(rows.map((r) => r.name)).toEqual(["001_ok.sql"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("applies new files added after the first run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "migrations-"));
    try {
      await writeFile(path.join(dir, "001_first.sql"), "CREATE TABLE first_table (id int);");
      await migrate(pool, dir);
      await writeFile(path.join(dir, "002_second.sql"), "CREATE TABLE second_table (id int);");

      const result = await migrate(pool, dir);

      expect(result.applied).toEqual(["002_second.sql"]);
      expect(result.skipped).toEqual(["001_first.sql"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
