import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db/client.js";
import { modelRoutes, requests } from "../db/schema.js";
import { requireAdminAuth } from "../middleware/auth.js";

const routeBody = z.object({
  alias: z.string().min(1),
  provider: z.string().min(1),
  realModel: z.string().min(1),
  fallback: z.array(z.object({ provider: z.string(), model: z.string(), baseUrl: z.string().optional() })).default([]),
  enabled: z.boolean().default(true)
});

export async function adminModelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/models", { preHandler: requireAdminAuth }, async () => {
    const rows = db.select().from(modelRoutes).all();
    const allRequests = db.select().from(requests).all();
    return {
      data: rows.map((row) => {
        const matching = allRequests.filter((request) => request.modelAlias === row.alias);
        const errors = matching.filter((request) => request.status === "error").length;
        return {
          ...row,
          fallback: JSON.parse(row.fallbackJson || "[]"),
          fallbackCount: JSON.parse(row.fallbackJson || "[]").length,
          avgLatencyMs: matching.length
            ? Math.round(matching.reduce((total, item) => total + item.latencyMs, 0) / matching.length)
            : 0,
          errorRate: matching.length ? errors / matching.length : 0
        };
      })
    };
  });

  app.post("/admin/models", { preHandler: requireAdminAuth }, async (request) => {
    const body = routeBody.parse(request.body);
    const row = {
      id: nanoid(),
      alias: body.alias,
      provider: body.provider,
      realModel: body.realModel,
      fallbackJson: JSON.stringify(body.fallback),
      enabled: body.enabled,
      createdAt: new Date().toISOString()
    };
    db.insert(modelRoutes).values(row).run();
    return row;
  });

  app.patch("/admin/models/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = routeBody.partial().parse(request.body);
    db.update(modelRoutes)
      .set({
        alias: body.alias,
        provider: body.provider,
        realModel: body.realModel,
        fallbackJson: body.fallback ? JSON.stringify(body.fallback) : undefined,
        enabled: body.enabled
      })
      .where(eq(modelRoutes.id, params.id))
      .run();
    return db.select().from(modelRoutes).where(eq(modelRoutes.id, params.id)).get();
  });

  app.delete("/admin/models/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    db.delete(modelRoutes).where(eq(modelRoutes.id, params.id)).run();
    return { ok: true };
  });
}
