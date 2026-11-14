import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";

interface AppDeps {
  pool: Pool;
  logger?: boolean;
}

export function buildApp({ pool, logger = false }: AppDeps): FastifyInstance {
  const app = Fastify({ logger });

  app.get("/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok", database: "up" };
    } catch (err) {
      app.log.error({ err }, "database health check failed");
      return reply.code(503).send({ status: "degraded", database: "down" });
    }
  });

  return app;
}
