import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GatewayError } from "@ai-gateway/core/errors";
import { requireApiAuth } from "../middleware/auth.js";
import { listModelAliases } from "../router/resolve-model.js";

function createdTimestamp(createdAt?: string): number {
  if (!createdAt) {
    return 0;
  }
  const value = Math.floor(new Date(createdAt).getTime() / 1000);
  return Number.isFinite(value) ? value : 0;
}

function toModelObject(model: ReturnType<typeof listModelAliases>[number]): Record<string, unknown> {
  return {
    id: model.alias,
    object: "model",
    created: createdTimestamp(model.createdAt),
    owned_by: model.provider
  };
}

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/models", { preHandler: requireApiAuth }, async () => ({
    object: "list",
    data: listModelAliases()
      .filter((model) => model.enabled)
      .map(toModelObject)
  }));

  app.get("/v1/models/:model", { preHandler: requireApiAuth }, async (request) => {
    const params = z.object({ model: z.string().min(1) }).parse(request.params);
    const model = listModelAliases().find((item) => item.enabled && item.alias === params.model);
    if (!model) {
      throw new GatewayError(`The model '${params.model}' does not exist.`, {
        code: "model_not_found",
        statusCode: 404,
        param: "model"
      });
    }
    return toModelObject(model);
  });
}
