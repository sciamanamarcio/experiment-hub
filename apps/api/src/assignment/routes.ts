import type { FastifyInstance } from "fastify";
import { assignSchema } from "./schemas";
import type { AssignmentService } from "./service";

export function registerAssignmentRoutes(app: FastifyInstance, service: AssignmentService): void {
  // What an application calls: "which variant does this user see?"
  app.post("/assign", async (request) => {
    const { subjectId, keys } = assignSchema.parse(request.body);
    return service.assign(subjectId, keys);
  });
}
