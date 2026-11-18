import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createTestPool, migratedDatabase } from "./helpers";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe("ingestion API", () => {
  let pool: Pool;
  let app: FastifyInstance;

  beforeAll(() => {
    pool = createTestPool();
    app = buildApp({ pool });
  });
  beforeEach(() => migratedDatabase(pool));
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  async function createExperiment(key = "checkout-button", body: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: "POST",
      url: "/experiments",
      payload: {
        key,
        name: `Experiment ${key}`,
        variants: [
          { key: "control", name: "Control", isControl: true },
          { key: "treatment", name: "Treatment" },
        ],
        ...body,
      },
    });
    return res.json().id as string;
  }

  const start = (id: string) =>
    app.inject({ method: "PUT", url: `/experiments/${id}/status`, payload: { status: "running" } });
  const expose = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/exposures", payload });
  const sendEvents = (events: Record<string, unknown>[]) =>
    app.inject({ method: "POST", url: "/events", payload: { events } });
  const countRows = async (table: string) =>
    Number((await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`)).rows[0].count);

  describe("POST /exposures", () => {
    it("records the first exposure with the variant the server computes", async () => {
      await start(await createExperiment());

      // user-3 is "treatment" in the assignment reference values
      const res = await expose({ experimentKey: "checkout-button", subjectId: "user-3" });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ recorded: true, variant: "treatment", reason: "recorded" });
      const { rows } = await pool.query(
        `SELECT e.subject_id, v.key AS variant FROM exposures e JOIN variants v ON v.id = e.variant_id`,
      );
      expect(rows).toEqual([{ subject_id: "user-3", variant: "treatment" }]);
    });

    it("agrees with /assign for the same subject", async () => {
      await start(await createExperiment());

      const assigned = await app.inject({
        method: "POST",
        url: "/assign",
        payload: { subjectId: "user-1", keys: ["checkout-button"] },
      });
      const exposed = await expose({ experimentKey: "checkout-button", subjectId: "user-1" });

      expect(exposed.json().variant).toBe(assigned.json().experiments["checkout-button"].variant);
    });

    it("is idempotent: a repeated exposure does not create a second row", async () => {
      await start(await createExperiment());
      await expose({ experimentKey: "checkout-button", subjectId: "user-3" });

      const again = await expose({ experimentKey: "checkout-button", subjectId: "user-3" });

      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ recorded: false, variant: "treatment", reason: "already_exposed" });
      expect(await countRows("exposures")).toBe(1);
    });

    it("records only once when the same exposure arrives many times at the same time", async () => {
      await start(await createExperiment());

      const responses = await Promise.all(
        Array.from({ length: 8 }, () => expose({ experimentKey: "checkout-button", subjectId: "user-3" })),
      );

      expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(responses.filter((r) => r.statusCode === 200)).toHaveLength(7);
      expect(await countRows("exposures")).toBe(1);
    });

    it("records different subjects separately", async () => {
      await start(await createExperiment());

      await expose({ experimentKey: "checkout-button", subjectId: "user-1" });
      await expose({ experimentKey: "checkout-button", subjectId: "user-2" });

      expect(await countRows("exposures")).toBe(2);
    });

    it("does not record anything while the experiment is not running", async () => {
      await createExperiment();

      const res = await expose({ experimentKey: "checkout-button", subjectId: "user-3" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ recorded: false, variant: null, reason: "not_running" });
      expect(await countRows("exposures")).toBe(0);
    });

    it("does not record a subject that is outside the traffic", async () => {
      const id = await createExperiment();
      await start(id);
      await app.inject({ method: "PATCH", url: `/experiments/${id}`, payload: { trafficPercentage: 0 } });

      const res = await expose({ experimentKey: "checkout-button", subjectId: "user-3" });

      expect(res.json()).toEqual({ recorded: false, variant: null, reason: "not_in_traffic" });
      expect(await countRows("exposures")).toBe(0);
    });

    it("answers not_found for an experiment that does not exist", async () => {
      const res = await expose({ experimentKey: "ghost-experiment", subjectId: "user-1" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ recorded: false, variant: null, reason: "not_found" });
    });

    it("rejects invalid bodies", async () => {
      const noSubject = await expose({ experimentKey: "checkout-button" });
      const badKey = await expose({ experimentKey: "Not A Slug", subjectId: "user-1" });
      const spoofed = await expose({ experimentKey: "checkout-button", subjectId: "user-1", variant: "treatment" });

      expect(noSubject.statusCode).toBe(400);
      expect(badKey.statusCode).toBe(400);
      expect(spoofed.statusCode).toBe(400); // the client cannot choose its variant
    });
  });

  describe("POST /events", () => {
    it("stores an event with defaults", async () => {
      const res = await sendEvents([{ subjectId: "user-1", name: "page_view" }]);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: 1, accepted: 1, duplicates: 0 });
      const { rows } = await pool.query("SELECT subject_id, name, value, properties FROM events");
      expect(rows).toEqual([{ subject_id: "user-1", name: "page_view", value: "0", properties: {} }]);
    });

    it("stores a batch, with value and nested properties", async () => {
      const res = await sendEvents([
        { subjectId: "user-1", name: "purchase", value: 19.9, properties: { items: [{ sku: "a-1", qty: 2 }], coupon: null } },
        { subjectId: "user-2", name: "purchase", value: 5 },
        { subjectId: "user-3", name: "signup" },
      ]);

      expect(res.json()).toEqual({ received: 3, accepted: 3, duplicates: 0 });
      const { rows } = await pool.query("SELECT value, properties FROM events WHERE subject_id = 'user-1'");
      expect(rows[0]).toEqual({
        value: "19.9",
        properties: { items: [{ sku: "a-1", qty: 2 }], coupon: null },
      });
    });

    it("counts an event only once when it is retried with the same idempotency key", async () => {
      const event = { subjectId: "user-1", name: "purchase", value: 10, idempotencyKey: "order-1001" };
      await sendEvents([event]);

      const retry = await sendEvents([event]);

      expect(retry.json()).toEqual({ received: 1, accepted: 0, duplicates: 1 });
      expect(await countRows("events")).toBe(1);
    });

    it("skips duplicates inside the same batch and keeps the rest", async () => {
      const res = await sendEvents([
        { subjectId: "user-1", name: "purchase", idempotencyKey: "order-1" },
        { subjectId: "user-1", name: "purchase", idempotencyKey: "order-1" },
        { subjectId: "user-2", name: "purchase", idempotencyKey: "order-2" },
      ]);

      expect(res.json()).toEqual({ received: 3, accepted: 2, duplicates: 1 });
      expect(await countRows("events")).toBe(2);
    });

    it("stores only one row when the same keyed event arrives many times at the same time", async () => {
      const event = { subjectId: "user-1", name: "purchase", idempotencyKey: "order-777" };

      const responses = await Promise.all(Array.from({ length: 8 }, () => sendEvents([event])));

      const accepted = responses.reduce((sum, r) => sum + r.json().accepted, 0);
      expect(accepted).toBe(1);
      expect(await countRows("events")).toBe(1);
    });

    it("does not deduplicate events that have no idempotency key", async () => {
      await sendEvents([{ subjectId: "user-1", name: "page_view" }]);
      await sendEvents([{ subjectId: "user-1", name: "page_view" }]);

      expect(await countRows("events")).toBe(2);
    });

    it("keeps the time the event happened, and rejects impossible times", async () => {
      const now = Date.now();
      const yesterday = new Date(now - DAY).toISOString();

      const ok = await sendEvents([{ subjectId: "user-1", name: "page_view", occurredAt: yesterday }]);
      const future = await sendEvents([
        { subjectId: "user-1", name: "page_view", occurredAt: new Date(now + 10 * MINUTE).toISOString() },
      ]);
      const tooOld = await sendEvents([
        { subjectId: "user-1", name: "page_view", occurredAt: new Date(now - 31 * DAY).toISOString() },
      ]);

      expect(ok.statusCode).toBe(200);
      const { rows } = await pool.query<{ occurred_at: Date }>("SELECT occurred_at FROM events");
      expect(rows[0].occurred_at.toISOString()).toBe(yesterday);
      expect(future.statusCode).toBe(400);
      expect(future.json().error.details[0]).toMatchObject({ path: "events.0.occurredAt", message: "is in the future" });
      expect(tooOld.statusCode).toBe(400);
      expect(tooOld.json().error.details[0].message).toBe("is older than 30 days");
    });

    it("stores nothing when any event of the batch is invalid", async () => {
      const res = await sendEvents([
        { subjectId: "user-1", name: "purchase" },
        { subjectId: "user-2", name: "Not Snake Case" },
      ]);

      expect(res.statusCode).toBe(400);
      expect(await countRows("events")).toBe(0);
    });

    it("rejects an empty batch, a batch that is too large and unknown fields", async () => {
      const empty = await sendEvents([]);
      const tooMany = await sendEvents(Array.from({ length: 101 }, () => ({ subjectId: "user-1", name: "page_view" })));
      const unknown = await sendEvents([{ subjectId: "user-1", name: "page_view", extra: true }]);

      expect(empty.statusCode).toBe(400);
      expect(tooMany.statusCode).toBe(400);
      expect(unknown.statusCode).toBe(400);
    });

    it("rejects values out of range and oversized properties", async () => {
      const hugeValue = await sendEvents([{ subjectId: "user-1", name: "purchase", value: 1e15 }]);
      const bigProperties = await sendEvents([
        { subjectId: "user-1", name: "purchase", properties: { blob: "x".repeat(5000) } },
      ]);

      expect(hugeValue.statusCode).toBe(400);
      expect(bigProperties.statusCode).toBe(400);
    });
  });
});
