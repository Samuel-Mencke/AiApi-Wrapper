import type { FastifyInstance } from "fastify";
import { requireAdminAuth } from "../middleware/auth.js";
import { db } from "../db/client.js";
import { requests } from "../db/schema.js";

export async function adminLogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/logs", { preHandler: requireAdminAuth }, async () => ({
    data: db.select().from(requests).all().reverse().slice(0, 500)
  }));
}
