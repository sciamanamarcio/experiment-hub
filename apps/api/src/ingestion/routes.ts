import type { FastifyInstance } from "fastify";
import { eventsBatchSchema, exposureSchema } from "./schemas";
import type { IngestionService } from "./service";

export function registerIngestionRoutes(app: FastifyInstance, service: IngestionService): void {
  // "This user just saw experiment X." 201 when recorded, 200 when it was not (and why).
  app.post("/exposures", async (request, reply) => {
    const { experimentKey, subjectId } = exposureSchema.parse(request.body);
    const result = await service.recordExposure(experimentKey, subjectId);
    return reply.code(result.recorded ? 201 : 200).send(result);
  });

  // "These things happened." Safe to retry when each event carries an idempotency key.
  app.post("/events", async (request) => {
    const { events } = eventsBatchSchema.parse(request.body);
    return service.recordEvents(events);
  });
}
