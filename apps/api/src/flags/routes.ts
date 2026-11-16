import type { FastifyInstance } from "fastify";
import {
  createFlagSchema,
  evaluateSchema,
  flagParams,
  listQuerySchema,
  overrideBodySchema,
  overrideParams,
  updateFlagSchema,
} from "./schemas";
import type { FlagService } from "./service";

export function registerFlagRoutes(app: FastifyInstance, service: FlagService): void {
  app.post("/flags", async (request, reply) => {
    const flag = await service.create(createFlagSchema.parse(request.body));
    return reply.code(201).header("Location", `/flags/${flag.id}`).send(flag);
  });

  app.get("/flags", async (request) => service.list(listQuerySchema.parse(request.query)));

  app.get("/flags/:id", async (request) => {
    const { id } = flagParams.parse(request.params);
    return service.get(id);
  });

  app.patch("/flags/:id", async (request) => {
    const { id } = flagParams.parse(request.params);
    return service.update(id, updateFlagSchema.parse(request.body));
  });

  app.delete("/flags/:id", async (request, reply) => {
    const { id } = flagParams.parse(request.params);
    await service.remove(id);
    return reply.code(204).send();
  });

  app.get("/flags/:id/overrides", async (request) => {
    const { id } = flagParams.parse(request.params);
    return service.listOverrides(id, listQuerySchema.parse(request.query));
  });

  app.put("/flags/:id/overrides/:subjectId", async (request) => {
    const { id, subjectId } = overrideParams.parse(request.params);
    const { enabled } = overrideBodySchema.parse(request.body);
    return service.setOverride(id, subjectId, enabled);
  });

  app.delete("/flags/:id/overrides/:subjectId", async (request, reply) => {
    const { id, subjectId } = overrideParams.parse(request.params);
    await service.removeOverride(id, subjectId);
    return reply.code(204).send();
  });

  // What an application calls: "which flags are on for this user?"
  app.post("/evaluate", async (request) => {
    const { subjectId, keys } = evaluateSchema.parse(request.body);
    return service.evaluate(subjectId, keys);
  });
}
