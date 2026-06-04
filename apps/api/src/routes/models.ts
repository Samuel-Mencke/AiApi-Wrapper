import type { FastifyInstance } from "fastify";
import { requireApiAuth } from "../middleware/auth.js";
import { listModelAliases } from "../router/resolve-model.js";

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/models", { preHandler: requireApiAuth }, async () => ({
    object: "list",
    data: listModelAliases()
      .filter((model) => model.enabled)
      .map((model) => ({
        id: model.alias,
        object: "model",
        created: 0,
        owned_by: "ai-gateway"
      }))
  }));
}
