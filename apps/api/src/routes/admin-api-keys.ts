import { eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { GatewayError } from "@model-console/core/errors";
import { db } from "../db/client.js";
import { apiKeys } from "../db/schema.js";
import { hashApiKey, requireAdminAuth } from "../middleware/auth.js";

export async function adminApiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api-keys", { preHandler: requireAdminAuth }, async () => ({
    data: db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      enabled: apiKeys.enabled,
      monthlyLimit: apiKeys.monthlyLimit,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt
    }).from(apiKeys).where(ne(apiKeys.id, "system")).all()
  }));

  app.post("/admin/api-keys", { preHandler: requireAdminAuth }, async (request) => {
    const body = z.object({
      name: z.string().min(1),
      monthlyLimit: z.number().int().positive().optional()
    }).parse(request.body);
    const key = `gw_${nanoid(32)}`;
    const row = {
      id: nanoid(),
      name: body.name,
      keyHash: hashApiKey(key),
      enabled: true,
      monthlyLimit: body.monthlyLimit,
      createdAt: new Date().toISOString()
    };
    db.insert(apiKeys).values(row).run();
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      monthlyLimit: row.monthlyLimit,
      createdAt: row.createdAt,
      key
    };
  });

  app.delete("/admin/api-keys/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (params.id === "system") {
      return { ok: false, message: "Cannot delete internal system key" };
    }
    db.delete(apiKeys).where(eq(apiKeys.id, params.id)).run();
    return { ok: true };
  });

  app.patch("/admin/api-keys/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (params.id === "system") {
      throw new GatewayError("Cannot edit internal system key", {
        code: "invalid_request",
        statusCode: 400,
        param: "id"
      });
    }

    const body = z.object({
      name: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
      monthlyLimit: z.number().int().positive().nullable().optional()
    }).parse(request.body);

    const existing = db.select().from(apiKeys).where(eq(apiKeys.id, params.id)).get();
    if (!existing) {
      throw new GatewayError("API key not found", {
        code: "api_key_not_found",
        statusCode: 404,
        param: "id"
      });
    }

    db.update(apiKeys)
      .set({
        name: body.name,
        enabled: body.enabled,
        monthlyLimit: body.monthlyLimit
      })
      .where(eq(apiKeys.id, params.id))
      .run();

    return db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      enabled: apiKeys.enabled,
      monthlyLimit: apiKeys.monthlyLimit,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt
    }).from(apiKeys).where(eq(apiKeys.id, params.id)).get();
  });
}
