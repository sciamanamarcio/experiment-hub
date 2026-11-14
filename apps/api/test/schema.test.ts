import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestPool,
  insertExperiment,
  insertVariant,
  migratedDatabase,
} from "./helpers";

// PostgreSQL error codes
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

describe("database schema", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(() => migratedDatabase(pool));
  afterAll(() => pool.end());

  describe("experiments", () => {
    it("starts as a draft with 100% of the traffic", async () => {
      const id = await insertExperiment(pool);

      const { rows } = await pool.query("SELECT status, traffic_percentage FROM experiments WHERE id = $1", [id]);

      expect(rows[0]).toEqual({ status: "draft", traffic_percentage: 100 });
    });

    it("rejects a key that is not a slug", async () => {
      await expect(
        pool.query("INSERT INTO experiments (key, name) VALUES ('Bad Key', 'x')"),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("rejects a duplicated key", async () => {
      await insertExperiment(pool, "same-key");

      await expect(insertExperiment(pool, "same-key")).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it("rejects traffic outside 0 to 100", async () => {
      await expect(
        pool.query("INSERT INTO experiments (key, name, traffic_percentage) VALUES ('a', 'a', 101)"),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });

    it("rejects an unknown status", async () => {
      await expect(
        pool.query("INSERT INTO experiments (key, name, status) VALUES ('a', 'a', 'archived')"),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  describe("variants", () => {
    it("allows the same variant key in different experiments", async () => {
      const first = await insertExperiment(pool, "first");
      const second = await insertExperiment(pool, "second");

      await insertVariant(pool, first, "control", true);

      await expect(insertVariant(pool, second, "control", true)).resolves.toBeTypeOf("string");
    });

    it("rejects a duplicated variant key inside one experiment", async () => {
      const experiment = await insertExperiment(pool);
      await insertVariant(pool, experiment, "treatment");

      await expect(insertVariant(pool, experiment, "treatment")).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
    });

    it("allows only one control variant per experiment", async () => {
      const experiment = await insertExperiment(pool);
      await insertVariant(pool, experiment, "control", true);

      await expect(insertVariant(pool, experiment, "other-control", true)).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
      });
    });

    it("rejects a weight that is not positive", async () => {
      const experiment = await insertExperiment(pool);

      await expect(
        pool.query("INSERT INTO variants (experiment_id, key, name, weight) VALUES ($1, 'v', 'v', 0)", [
          experiment,
        ]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    });
  });

  describe("exposures", () => {
    it("counts only the first exposure of a subject in an experiment", async () => {
      const experiment = await insertExperiment(pool);
      const control = await insertVariant(pool, experiment, "control", true);
      const treatment = await insertVariant(pool, experiment, "treatment");
      const insert = (variant: string, subject: string) =>
        pool.query("INSERT INTO exposures (experiment_id, variant_id, subject_id) VALUES ($1, $2, $3)", [
          experiment,
          variant,
          subject,
        ]);

      await insert(control, "user-1");
      await insert(treatment, "user-2");

      await expect(insert(treatment, "user-1")).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it("is removed together with its experiment", async () => {
      const experiment = await insertExperiment(pool);
      const control = await insertVariant(pool, experiment, "control", true);
      await pool.query("INSERT INTO exposures (experiment_id, variant_id, subject_id) VALUES ($1, $2, 'user-1')", [
        experiment,
        control,
      ]);

      await pool.query("DELETE FROM experiments WHERE id = $1", [experiment]);

      const variants = await pool.query("SELECT 1 FROM variants");
      const exposures = await pool.query("SELECT 1 FROM exposures");
      expect(variants.rowCount).toBe(0);
      expect(exposures.rowCount).toBe(0);
    });
  });

  describe("events", () => {
    it("rejects a repeated idempotency key", async () => {
      const insert = () =>
        pool.query("INSERT INTO events (idempotency_key, subject_id, name) VALUES ('evt-1', 'user-1', 'purchase')");
      await insert();

      await expect(insert()).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
    });

    it("accepts many events without an idempotency key", async () => {
      const insert = () => pool.query("INSERT INTO events (subject_id, name) VALUES ('user-1', 'page_view')");

      await insert();
      await insert();

      const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM events");
      expect(rows[0].count).toBe("2");
    });

    it("defaults to an empty properties object", async () => {
      await pool.query("INSERT INTO events (subject_id, name) VALUES ('user-1', 'page_view')");

      const { rows } = await pool.query("SELECT properties, value FROM events");

      expect(rows[0]).toEqual({ properties: {}, value: "0" });
    });
  });
});
