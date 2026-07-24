import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { GatewayError } from "@model-console/core/errors";
import { db } from "../db/client.js";
import { modelRoutes, providers, quotaSettings } from "../db/schema.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { anthropicAdapter } from "../providers/anthropic.js";
import { geminiAdapter } from "../providers/gemini.js";
import { createOpenAiCompatibleAdapter } from "../providers/openai-compatible.js";
import { openAiAdapter } from "../providers/openai.js";
import { openRouterAdapter } from "../providers/openrouter.js";
import type { ProviderAdapter } from "../providers/types.js";
import { invalidateRouteCache } from "../router/resolve-model.js";

const adapters: Record<string, ProviderAdapter> = {
  openai: openAiAdapter,
  openrouter: openRouterAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  custom: createOpenAiCompatibleAdapter("custom")
};

const providerFields = z.object({
  name: z.string().min(1),
  type: z.enum(["openai", "openrouter", "gemini", "anthropic", "custom"]),
  baseUrl: z.string().url().nullable().optional(),
  enabled: z.boolean().default(true)
});

const providerBody = providerFields.refine((value) => value.type !== "custom" || Boolean(value.baseUrl), {
  message: "Custom providers need a base URL",
  path: ["baseUrl"]
});

const providerPatchBody = providerFields.partial();

export async function adminProviderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/providers", { preHandler: requireAdminAuth }, async () => ({
    data: db.select().from(providers).all()
  }));

  app.post("/admin/providers", { preHandler: requireAdminAuth }, async (request) => {
    const body = providerBody.parse(request.body);
    const existing = db.select().from(providers).where(eq(providers.name, body.name)).get();
    if (existing) {
      throw new GatewayError(`Provider '${body.name}' already exists`, {
        code: "provider_already_exists",
        statusCode: 409,
        param: "name"
      });
    }

    const now = new Date().toISOString();
    const row = {
      id: nanoid(),
      name: body.name,
      type: body.type,
      baseUrl: body.baseUrl ?? null,
      enabled: body.enabled,
      createdAt: now
    };
    db.insert(providers).values(row).run();
    db.insert(quotaSettings).values({
      id: nanoid(),
      provider: body.name,
      modelAlias: "__provider__",
      enabled: false,
      windowHours: 5,
      requestLimit: null,
      tokenLimit: null,
      concurrencyLimit: null,
      createdAt: now,
      updatedAt: now
    }).run();
    invalidateRouteCache();
    return row;
  });

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
    const configuredRoute = body.modelAlias
      ? db.select().from(modelRoutes).where(eq(modelRoutes.alias, body.modelAlias)).get()
      : db.select().from(modelRoutes).where(eq(modelRoutes.provider, provider.name)).get();
    if (!configuredRoute) {
      return { ok: false, message: "No enabled model route configured for this provider" };
    }
    const modelAlias = configuredRoute.alias;
    const realModel = configuredRoute.realModel;
    const start = Date.now();
    try {
      const result = await adapter.complete(
        {
          modelAlias,
          messages: [{ role: "user", content: "Say 'test ok' in exactly those two words." }],
          maxTokens: 10,
          stream: false
        },
        { provider: provider.name, model: realModel },
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
    const body = providerPatchBody.parse(request.body);
    const existing = db.select().from(providers).where(eq(providers.id, params.id)).get();
    if (!existing) {
      throw new GatewayError("Provider not found", {
        code: "provider_not_found",
        statusCode: 404,
        param: "id"
      });
    }
    const nextType = body.type ?? existing.type;
    const nextBaseUrl = body.baseUrl === undefined ? existing.baseUrl : body.baseUrl;
    if (nextType === "custom" && !nextBaseUrl) {
      throw new GatewayError("Custom providers need a base URL", {
        code: "invalid_request",
        statusCode: 400,
        param: "baseUrl"
      });
    }
    if (body.name && body.name !== existing.name) {
      const duplicate = db.select().from(providers).where(eq(providers.name, body.name)).get();
      if (duplicate) {
        throw new GatewayError(`Provider '${body.name}' already exists`, {
          code: "provider_already_exists",
          statusCode: 409,
          param: "name"
        });
      }
      db.update(modelRoutes).set({ provider: body.name }).where(eq(modelRoutes.provider, existing.name)).run();
      db.update(quotaSettings).set({ provider: body.name, updatedAt: new Date().toISOString() }).where(eq(quotaSettings.provider, existing.name)).run();
    }

    db.update(providers)
      .set({
        name: body.name,
        type: body.type,
        baseUrl: body.baseUrl,
        enabled: body.enabled
      })
      .where(eq(providers.id, params.id))
      .run();
    invalidateRouteCache();
    return db.select().from(providers).where(eq(providers.id, params.id)).get();
  });

  app.delete("/admin/providers/:id", { preHandler: requireAdminAuth }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = db.select().from(providers).where(eq(providers.id, params.id)).get();
    if (!existing) {
      throw new GatewayError("Provider not found", {
        code: "provider_not_found",
        statusCode: 404,
        param: "id"
      });
    }

    const linkedRoutes = db.select().from(modelRoutes).where(eq(modelRoutes.provider, existing.name)).all();
    if (linkedRoutes.length > 0) {
      throw new GatewayError(`Provider '${existing.name}' is used by ${linkedRoutes.length} model route(s). Delete or move those routes first.`, {
        code: "provider_in_use",
        statusCode: 409,
        param: "id"
      });
    }

    db.delete(quotaSettings).where(eq(quotaSettings.provider, existing.name)).run();
    db.delete(providers).where(eq(providers.id, params.id)).run();
    invalidateRouteCache();
    return { ok: true };
  });
}
