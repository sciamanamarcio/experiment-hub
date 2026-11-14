import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createTestPool } from "./helpers";

describe("GET /health", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });
  afterAll(() => pool.end());

  it("reports ok when the database answers", async () => {
    const app = buildApp({ pool });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", database: "up" });
  });

  it("reports degraded with 503 when the database is down", async () => {
    const brokenPool = {
      query: async () => {
        throw new Error("connection refused");
      },
    } as unknown as Pool;
    const app = buildApp({ pool: brokenPool });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", database: "down" });
  });
});
