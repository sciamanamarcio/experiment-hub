import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createTestPool, migratedDatabase } from "./helpers";

describe("POST /assign", () => {
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

  async function createExperiment(key: string, body: Record<string, unknown> = {}) {
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
  const assign = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/assign", payload });

  it("assigns a variant for a running experiment", async () => {
    await start(await createExperiment("checkout-button"));

    const res = await assign({ subjectId: "user-3", keys: ["checkout-button"] });

    expect(res.statusCode).toBe(200);
    // the same reference value as the pure function's test
    expect(res.json()).toEqual({
      subjectId: "user-3",
      experiments: { "checkout-button": { variant: "treatment", reason: "assigned" } },
    });
  });

  it("gives the same answer on repeated calls", async () => {
    await start(await createExperiment("checkout-button"));

    const first = await assign({ subjectId: "user-123", keys: ["checkout-button"] });
    const second = await assign({ subjectId: "user-123", keys: ["checkout-button"] });

    expect(second.json()).toEqual(first.json());
  });

  it("gives no variant to an experiment that is not running", async () => {
    await createExperiment("still-draft");
    const paused = await createExperiment("paused-one");
    await start(paused);
    await app.inject({ method: "PUT", url: `/experiments/${paused}/status`, payload: { status: "paused" } });

    const res = await assign({ subjectId: "user-1", keys: ["still-draft", "paused-one"] });

    expect(res.json().experiments).toEqual({
      "still-draft": { variant: null, reason: "not_running" },
      "paused-one": { variant: null, reason: "not_running" },
    });
  });

  it("answers not_found for an experiment that does not exist", async () => {
    const res = await assign({ subjectId: "user-1", keys: ["ghost-experiment"] });

    expect(res.statusCode).toBe(200);
    expect(res.json().experiments["ghost-experiment"]).toEqual({ variant: null, reason: "not_found" });
  });

  it("considers every running experiment when no keys are given", async () => {
    await start(await createExperiment("running-a"));
    await start(await createExperiment("running-b"));
    await createExperiment("draft-one");

    const res = await assign({ subjectId: "user-1" });

    expect(Object.keys(res.json().experiments)).toEqual(["running-a", "running-b"]);
  });

  it("leaves subjects out when the traffic is reduced to 0%", async () => {
    const id = await createExperiment("checkout-button");
    await start(id);
    await app.inject({ method: "PATCH", url: `/experiments/${id}`, payload: { trafficPercentage: 0 } });

    const res = await assign({ subjectId: "user-3", keys: ["checkout-button"] });

    expect(res.json().experiments["checkout-button"]).toEqual({ variant: null, reason: "not_in_traffic" });
  });

  it("respects the weights stored in the database", async () => {
    // 1 : 99, so almost everybody must land on the heavy variant
    await start(
      await createExperiment("lopsided", {
        variants: [
          { key: "control", name: "Control", isControl: true, weight: 1 },
          { key: "treatment", name: "Treatment", weight: 99 },
        ],
      }),
    );

    let treatment = 0;
    for (let i = 0; i < 300; i++) {
      const res = await assign({ subjectId: `user-${i}`, keys: ["lopsided"] });
      if (res.json().experiments["lopsided"].variant === "treatment") treatment += 1;
    }

    expect(treatment).toBeGreaterThan(280);
  });

  it("rejects an empty subject, unknown fields and too many keys", async () => {
    const empty = await assign({ subjectId: "" });
    const unknown = await assign({ subjectId: "user-1", extra: true });
    const tooMany = await assign({
      subjectId: "user-1",
      keys: Array.from({ length: 101 }, (_, i) => `exp-${i}`),
    });

    expect(empty.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    expect(tooMany.statusCode).toBe(400);
  });
});
