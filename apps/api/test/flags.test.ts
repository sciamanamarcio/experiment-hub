import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createTestPool, migratedDatabase } from "./helpers";

describe("feature flags API", () => {
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

  async function createFlag(body: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: "/flags",
      payload: { key: "new-checkout", name: "New checkout", ...body },
    });
  }

  const evaluate = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/evaluate", payload });

  describe("CRUD", () => {
    it("creates a flag that is off and at 0% by default", async () => {
      const res = await createFlag();

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(res.headers.location).toBe(`/flags/${body.id}`);
      expect(body).toMatchObject({
        key: "new-checkout",
        enabled: false,
        rolloutPercentage: 0,
        description: null,
      });
    });

    it("rejects a bad key, a bad percentage and unknown fields", async () => {
      const badKey = await createFlag({ key: "Not A Slug" });
      const badPercentage = await createFlag({ rolloutPercentage: 120 });
      const unknown = await createFlag({ color: "blue" });

      expect(badKey.statusCode).toBe(400);
      expect(badPercentage.statusCode).toBe(400);
      expect(unknown.statusCode).toBe(400);
    });

    it("rejects a duplicated key", async () => {
      await createFlag();

      const res = await createFlag();

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("FLAG_KEY_TAKEN");
    });

    it("reads a flag, and answers 404 or 400 for a wrong id", async () => {
      const id = (await createFlag()).json().id;

      const found = await app.inject({ method: "GET", url: `/flags/${id}` });
      const missing = await app.inject({ method: "GET", url: "/flags/00000000-0000-4000-8000-000000000000" });
      const invalid = await app.inject({ method: "GET", url: "/flags/nope" });

      expect(found.statusCode).toBe(200);
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe("FLAG_NOT_FOUND");
      expect(invalid.statusCode).toBe(400);
    });

    it("lists with pagination, newest first", async () => {
      await createFlag({ key: "first" });
      await createFlag({ key: "second" });
      await createFlag({ key: "third" });

      const res = await app.inject({ method: "GET", url: "/flags?limit=2&page=1" });

      expect(res.json().data.map((f: { key: string }) => f.key)).toEqual(["third", "second"]);
      expect(res.json().meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    });

    it("updates a flag, clears the description with null and rejects an empty patch", async () => {
      const id = (await createFlag({ description: "old" })).json().id;

      const updated = await app.inject({
        method: "PATCH",
        url: `/flags/${id}`,
        payload: { enabled: true, rolloutPercentage: 25, description: null },
      });
      const empty = await app.inject({ method: "PATCH", url: `/flags/${id}`, payload: {} });
      const key = await app.inject({ method: "PATCH", url: `/flags/${id}`, payload: { key: "other" } });

      expect(updated.json()).toMatchObject({ enabled: true, rolloutPercentage: 25, description: null });
      expect(empty.statusCode).toBe(400);
      expect(key.statusCode).toBe(400);
    });

    it("deletes a flag together with its overrides", async () => {
      const id = (await createFlag()).json().id;
      await app.inject({ method: "PUT", url: `/flags/${id}/overrides/user-1`, payload: { enabled: true } });

      const res = await app.inject({ method: "DELETE", url: `/flags/${id}` });

      expect(res.statusCode).toBe(204);
      const { rows } = await pool.query("SELECT 1 FROM feature_flag_overrides");
      expect(rows).toHaveLength(0);
    });
  });

  describe("overrides", () => {
    it("creates, changes, lists and removes an override", async () => {
      const id = (await createFlag()).json().id;
      const put = (enabled: boolean) =>
        app.inject({ method: "PUT", url: `/flags/${id}/overrides/user-1`, payload: { enabled } });

      const created = await put(true);
      const changed = await put(false);
      const list = await app.inject({ method: "GET", url: `/flags/${id}/overrides` });
      const removed = await app.inject({ method: "DELETE", url: `/flags/${id}/overrides/user-1` });
      const removedAgain = await app.inject({ method: "DELETE", url: `/flags/${id}/overrides/user-1` });

      expect(created.json()).toMatchObject({ subjectId: "user-1", enabled: true });
      expect(changed.json().enabled).toBe(false);
      expect(list.json().meta.total).toBe(1);
      expect(list.json().data[0]).toMatchObject({ subjectId: "user-1", enabled: false });
      expect(removed.statusCode).toBe(204);
      expect(removedAgain.statusCode).toBe(404);
      expect(removedAgain.json().error.code).toBe("OVERRIDE_NOT_FOUND");
    });

    it("accepts subject ids with special characters", async () => {
      const id = (await createFlag()).json().id;
      const subject = encodeURIComponent("maria@example.com");

      const res = await app.inject({
        method: "PUT",
        url: `/flags/${id}/overrides/${subject}`,
        payload: { enabled: true },
      });

      expect(res.json().subjectId).toBe("maria@example.com");
    });

    it("answers 404 for a flag that does not exist", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/flags/00000000-0000-4000-8000-000000000000/overrides/user-1",
        payload: { enabled: true },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("evaluate", () => {
    it("answers off for a disabled flag", async () => {
      await createFlag({ enabled: false, rolloutPercentage: 100 });

      const res = await evaluate({ subjectId: "user-1", keys: ["new-checkout"] });

      expect(res.json()).toEqual({
        subjectId: "user-1",
        flags: { "new-checkout": { enabled: false, reason: "disabled" } },
      });
    });

    it("answers on for everyone at 100%", async () => {
      await createFlag({ enabled: true, rolloutPercentage: 100 });

      const res = await evaluate({ subjectId: "user-1", keys: ["new-checkout"] });

      expect(res.json().flags["new-checkout"]).toEqual({ enabled: true, reason: "rollout" });
    });

    it("applies the override of the subject, and only to that subject", async () => {
      const id = (await createFlag({ enabled: true, rolloutPercentage: 0 })).json().id;
      await app.inject({ method: "PUT", url: `/flags/${id}/overrides/vip-user`, payload: { enabled: true } });

      const vip = await evaluate({ subjectId: "vip-user", keys: ["new-checkout"] });
      const other = await evaluate({ subjectId: "someone-else", keys: ["new-checkout"] });

      expect(vip.json().flags["new-checkout"]).toEqual({ enabled: true, reason: "override" });
      expect(other.json().flags["new-checkout"]).toEqual({ enabled: false, reason: "not_in_rollout" });
    });

    it("answers off with not_found for a flag that does not exist", async () => {
      const res = await evaluate({ subjectId: "user-1", keys: ["ghost-flag"] });

      expect(res.statusCode).toBe(200);
      expect(res.json().flags["ghost-flag"]).toEqual({ enabled: false, reason: "not_found" });
    });

    it("evaluates every flag when no keys are given", async () => {
      await createFlag({ key: "flag-a", enabled: true, rolloutPercentage: 100 });
      await createFlag({ key: "flag-b", enabled: false });

      const res = await evaluate({ subjectId: "user-1" });

      expect(Object.keys(res.json().flags).sort()).toEqual(["flag-a", "flag-b"]);
    });

    it("returns the same answer on repeated calls", async () => {
      await createFlag({ enabled: true, rolloutPercentage: 50 });

      const first = await evaluate({ subjectId: "user-123", keys: ["new-checkout"] });
      const second = await evaluate({ subjectId: "user-123", keys: ["new-checkout"] });

      expect(second.json()).toEqual(first.json());
    });

    it("grows the rollout without taking the flag away from anyone", async () => {
      const id = (await createFlag({ enabled: true, rolloutPercentage: 10 })).json().id;
      const subjects = Array.from({ length: 200 }, (_, i) => `user-${i}`);
      const enabledFor = async () => {
        const result: string[] = [];
        for (const subjectId of subjects) {
          const res = await evaluate({ subjectId, keys: ["new-checkout"] });
          if (res.json().flags["new-checkout"].enabled) result.push(subjectId);
        }
        return result;
      };

      const at10 = await enabledFor();
      await app.inject({ method: "PATCH", url: `/flags/${id}`, payload: { rolloutPercentage: 40 } });
      const at40 = new Set(await enabledFor());

      expect(at10.length).toBeGreaterThan(0);
      expect(at40.size).toBeGreaterThan(at10.length);
      expect(at10.every((s) => at40.has(s))).toBe(true);
    });

    it("rejects an empty subject, unknown fields and too many keys", async () => {
      const empty = await evaluate({ subjectId: "" });
      const unknown = await evaluate({ subjectId: "user-1", extra: true });
      const tooMany = await evaluate({
        subjectId: "user-1",
        keys: Array.from({ length: 101 }, (_, i) => `flag-${i}`),
      });

      expect(empty.statusCode).toBe(400);
      expect(unknown.statusCode).toBe(400);
      expect(tooMany.statusCode).toBe(400);
    });
  });
});
