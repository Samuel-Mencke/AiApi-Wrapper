import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db/client.js";
import { chatThreads } from "../db/schema.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { createChatRunStream, getThreadPayload } from "../chat/orchestrator.js";
import { listChatModels, testChatModel } from "../chat/model-status.js";
import { listChatTools } from "../chat/tools.js";

const runBody = z.object({
  threadId: z.string().optional(),
  content: z.string().min(1),
  modelAlias: z.string().min(1),
  webSearch: z.boolean().optional()
});

export async function adminChatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/chat/threads", { preHandler: requireAdminAuth }, async () => ({
    data: db.select().from(chatThreads).all()
      .filter((thread) => !thread.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }));

  app.post("/admin/chat/threads", { preHandler: requireAdminAuth }, async () => {
    const now = new Date().toISOString();
    const thread = {
      id: nanoid(),
      userId: null,
      adminSessionId: "admin",
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };
    db.insert(chatThreads).values(thread).run();
    return { data: thread };
  });

  app.get("/admin/chat/threads/:id", { preHandler: requireAdminAuth }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const payload = getThreadPayload(params.id);
    if (!payload) return reply.code(404).send({ error: { message: "Thread not found" } });
    return { data: payload };
  });

  app.patch("/admin/chat/threads/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ title: z.string().min(1).max(160).optional(), archived: z.boolean().optional() }).parse(request.body);
    db.update(chatThreads)
      .set({
        title: body.title,
        archivedAt: body.archived === true ? new Date().toISOString() : body.archived === false ? null : undefined,
        updatedAt: new Date().toISOString()
      })
      .where(eq(chatThreads.id, params.id))
      .run();
    return { data: db.select().from(chatThreads).where(eq(chatThreads.id, params.id)).get() };
  });

  app.get("/admin/chat/models", { preHandler: requireAdminAuth }, async () => ({
    data: listChatModels()
  }));

  app.post("/admin/chat/models/:alias/test", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ alias: z.string() }).parse(request.params);
    return { data: await testChatModel(params.alias) };
  });

  app.get("/admin/chat/tools", { preHandler: requireAdminAuth }, async () => ({
    data: listChatTools({ webSearchEnabled: true }).map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
      riskLevel: tool.riskLevel,
      requiresConfirmation: tool.requiresConfirmation,
      timeoutMs: tool.timeoutMs
    }))
  }));

  app.post("/admin/chat/runs/stream", { preHandler: requireAdminAuth }, async (request, reply) => {
    const body = runBody.parse(request.body);
    const stream = createChatRunStream(body);
    const origin = request.headers.origin;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(origin ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin"
      } : {})
    });
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply.raw.write(value);
      }
      reply.raw.end();
    } catch {
      try {
        reply.raw.end();
      } catch {
        // ignore
      }
    }
  });
}
