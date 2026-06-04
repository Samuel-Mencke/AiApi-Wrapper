import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { providers } from "../db/schema.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { anthropicAdapter } from "../providers/anthropic.js";
import { geminiAdapter } from "../providers/gemini.js";
import { createOpenAiCompatibleAdapter } from "../providers/openai-compatible.js";
import { openAiAdapter } from "../providers/openai.js";
import { openRouterAdapter } from "../providers/openrouter.js";
import type { ProviderAdapter } from "../providers/types.js";

const adapters: Record<string, ProviderAdapter> = {
  openai: openAiAdapter,
  openrouter: openRouterAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  custom: createOpenAiCompatibleAdapter("custom")
};

export async function adminProviderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/providers", { preHandler: requireAdminAuth }, async () => ({
    data: db.select().from(providers).all()
  }));

  app.post("/admin/providers/test", { preHandler: requireAdminAuth }, async (request) => {
    const body = z.object({ provider: z.string().min(1), modelAlias: z.string().optional() }).parse(request.body);
    const provider = db.select().from(providers).where(eq(providers.name, body.provider)).get();
    if (!provider) {
      return { ok: false, message: "Provider not found" };
    }
    const adapter = adapters[provider.type] ?? adapters[provider.name];
    if (!adapter) {
      return { ok: false, message: "No adapter registered" };
    }
    const start = Date.now();
    try {
      const result = await adapter.complete(
        {
          modelAlias: body.modelAlias ?? "glm-5-turbo",
          messages: [{ role: "user", content: "Say 'test ok' in exactly those two words." }],
          maxTokens: 10,
          stream: false
        },
        { provider: provider.name, model: body.modelAlias ?? "glm-5-turbo" },
        {
          name: provider.name,
          type: provider.type as "openai" | "openrouter" | "gemini" | "anthropic" | "custom",
          baseUrl: provider.baseUrl ?? undefined,
          enabled: provider.enabled
        }
      );
      const latencyMs = Date.now() - start;
      const content = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
      return { ok: true, message: content.slice(0, 200), latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - start;
      return { ok: false, message: error instanceof Error ? error.message : "Provider test failed", latencyMs };
    }
  });

  app.patch("/admin/providers/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ enabled: z.boolean().optional() }).parse(request.body);
    db.update(providers).set({ enabled: body.enabled }).where(eq(providers.id, params.id)).run();
    return db.select().from(providers).where(eq(providers.id, params.id)).get();
  });
}
