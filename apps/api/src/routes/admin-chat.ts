import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { db, sqlite } from "../db/client.js";
import { chatThreads } from "../db/schema.js";
import { env } from "../env.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { createChatRunStream, getThreadPayload, getActivePath } from "../chat/orchestrator.js";
import { listChatModels, testChatModel } from "../chat/model-status.js";
import { listChatTools } from "../chat/tools.js";
import { answerQuestion, getActivePlan, listAgentEvents, listCheckpoints, listQuestions, listSubagents, restoreCheckpoint } from "../chat/agent-state.js";

const runBody = z.object({
  threadId: z.string().optional(),
  content: z.string().min(1),
  modelAlias: z.string().min(1),
  webSearch: z.boolean().optional(),
  mode: z.enum(["agent","ask","plan"]).optional(),
  parentMessageId: z.string().optional(),
  attachments: z.array(z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    url: z.string()
  })).optional()
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

  app.get("/admin/chat/threads/:id/agent-state", { preHandler: requireAdminAuth }, async request => { const {id}=z.object({id:z.string()}).parse(request.params); return {data:{plan:getActivePlan(id),events:listAgentEvents(id),checkpoints:listCheckpoints(id),questions:listQuestions(id),subagents:listSubagents(id)}}; });
  app.post("/admin/chat/questions/:id/answer", { preHandler: requireAdminAuth }, async request => {const {id}=z.object({id:z.string()}).parse(request.params);const {answer}=z.object({answer:z.string().min(1).max(4000)}).parse(request.body);return {data:answerQuestion(id,answer)};});
  app.post("/admin/chat/checkpoints/:id/restore", { preHandler: requireAdminAuth }, async request => {const {id}=z.object({id:z.string()}).parse(request.params);return {data:await restoreCheckpoint(id)};});

  // Delete a single message (and optionally its children)
  app.delete("/admin/chat/messages/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ cascade: z.boolean().optional() }).optional().parse(request.body);
    // Collect message + descendants if cascade
    const toDelete: string[] = [params.id];
    if (body?.cascade) {
      let frontier = [params.id];
      while (frontier.length) {
        const children = sqlite.prepare("SELECT id FROM chat_messages WHERE parent_message_id IN (" + frontier.map(() => "?").join(",") + ")")
          .all(...frontier) as Array<{ id: string }>;
        const childIds = children.map((c) => c.id).filter((id) => !toDelete.includes(id));
        toDelete.push(...childIds);
        frontier = childIds;
      }
    }
    for (const id of toDelete) {
      sqlite.prepare("DELETE FROM chat_messages WHERE id = ?").run(id);
    }
    return { data: { deleted: toDelete.length, ids: toDelete } };
  });

  // Get active path (the currently visible message chain)
  app.get("/admin/chat/threads/:id/path", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    return { data: { path: getActivePath(params.id) } };
  });

  // Upload endpoint for file/image attachments
  app.post("/admin/chat/upload", { preHandler: requireAdminAuth }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: { message: "No file uploaded" } });
    const allowedMime = [
      "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
      "application/pdf", "text/plain", "text/markdown", "text/csv",
      "application/json", "application/javascript", "text/typescript",
      "application/zip", "application/x-tar", "application/gzip",
      "text/x-python", "text/x-shellscript", "application/octet-stream"
    ];
    const maxBytes = 15 * 1024 * 1024; // 15 MB
    const mime = data.mimetype;
    if (!allowedMime.includes(mime) && !mime.startsWith("image/") && !mime.startsWith("text/")) {
      return reply.code(415).send({ error: { message: `File type ${mime} not allowed` } });
    }
    const uploadDir = path.resolve(env.root, "data", "uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const id = nanoid();
    const ext = path.extname(data.filename || "");
    const storedName = `${id}${ext}`;
    const filePath = path.resolve(uploadDir, storedName);
    const buffer = await data.toBuffer();
    if (buffer.byteLength > maxBytes) {
      return reply.code(413).send({ error: { message: "File exceeds 15MB limit" } });
    }
    fs.writeFileSync(filePath, buffer);
    const url = `/uploads/${storedName}`;
    const stat = fs.statSync(filePath);
    return {
      data: {
        id,
        filename: data.filename || storedName,
        mimeType: mime,
        size: stat.size,
        url
      }
    };
  });
}
