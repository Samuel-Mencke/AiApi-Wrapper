import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db/client.js";
import { apiKeys, modelRoutes, providers, quotaSettings, requests } from "../db/schema.js";
import { env } from "../env.js";
import { requireAdminAuth } from "../middleware/auth.js";

function startOfToday(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

const quotaPatchBody = z.object({
  provider: z.string().min(1),
  modelAlias: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  windowHours: z.number().int().positive().optional(),
  requestLimit: z.number().int().positive().nullable().optional(),
  tokenLimit: z.number().int().positive().nullable().optional()
});

type RequestRow = typeof requests.$inferSelect;

interface UsageAggregate {
  id: string;
  label: string;
  provider?: string;
  modelAlias?: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  latencyTotal: number;
  averageLatencyMs: number;
  errorRate: number;
}

function emptyUsage(id: string, label: string, extra: Pick<UsageAggregate, "provider" | "modelAlias"> = {}): UsageAggregate {
  return {
    id,
    label,
    ...extra,
    requests: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    latencyTotal: 0,
    averageLatencyMs: 0,
    errorRate: 0
  };
}

function addUsage(usage: UsageAggregate, request: RequestRow): void {
  usage.requests += 1;
  usage.errors += request.status === "error" ? 1 : 0;
  usage.inputTokens += request.inputTokens ?? 0;
  usage.outputTokens += request.outputTokens ?? 0;
  usage.totalTokens += (request.inputTokens ?? 0) + (request.outputTokens ?? 0);
  usage.estimatedCost += request.estimatedCost ?? 0;
  usage.latencyTotal += request.latencyMs;
}

function finalizeUsage(usage: UsageAggregate): UsageAggregate {
  return {
    ...usage,
    estimatedCost: Number(usage.estimatedCost.toFixed(6)),
    averageLatencyMs: usage.requests ? Math.round(usage.latencyTotal / usage.requests) : 0,
    errorRate: usage.requests ? usage.errors / usage.requests : 0
  };
}

function zAiConcurrencyLimit(model: string): number | null {
  const normalized = model.toLowerCase();
  if (normalized === "glm-5.1") return 10;
  if (normalized === "glm-5-turbo") return 1;
  if (normalized === "glm-4.6") return 3;
  if (normalized === "glm-4.7") return 2;
  return null;
}

function ensureQuotaSettings(): void {
  const now = new Date().toISOString();
  const routes = db.select().from(modelRoutes).all();
  for (const route of routes) {
    const existing = db.select().from(quotaSettings).where(eq(quotaSettings.modelAlias, route.alias)).get();
    if (!existing) {
      db.insert(quotaSettings).values({
        id: nanoid(),
        provider: route.provider,
        modelAlias: route.alias,
        enabled: route.provider === "z-ai" && route.alias === "z-ai-coding",
        windowHours: 5,
        requestLimit: null,
        tokenLimit: null,
        concurrencyLimit: route.provider === "z-ai" ? zAiConcurrencyLimit(route.realModel) : null,
        createdAt: now,
        updatedAt: now
      }).run();
    }
  }
}

function apiKeyNameMap(): Map<string, string> {
  return new Map(db.select().from(apiKeys).all().map((key) => [key.id, key.name]));
}

export async function adminStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/stats", { preHandler: requireAdminAuth }, async () => {
    ensureQuotaSettings();
    const allRequests = db.select().from(requests).all();
    const activeProviders = db.select().from(providers).all().filter((provider) => provider.enabled).length;
    const keyNames = apiKeyNameMap();
    const today = startOfToday();
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const requestsToday = allRequests.filter((request) => request.createdAt >= today).length;
    const requestsLast5h = allRequests.filter((request) => request.createdAt >= fiveHoursAgo).length;
    const errors = allRequests.filter((request) => request.status === "error").length;
    const averageLatencyMs = allRequests.length
      ? Math.round(allRequests.reduce((total, request) => total + request.latencyMs, 0) / allRequests.length)
      : 0;
    const totalTokens = allRequests.reduce((total, request) => total + (request.inputTokens ?? 0) + (request.outputTokens ?? 0), 0);

    const hourly = new Map<string, { requests: number; errors: number }>();
    const hourlyByProvider = new Map<string, { time: string; key: string; requests: number; errors: number }>();
    const hourlyByModel = new Map<string, { time: string; key: string; requests: number; errors: number }>();
    const hourlyByApiKey = new Map<string, { time: string; key: string; requests: number; errors: number }>();
    const costByProvider = new Map<string, number>();
    const latencyByProvider = new Map<string, { latency: number; count: number }>();
    const usageByProvider = new Map<string, UsageAggregate>();
    const usageByModel = new Map<string, UsageAggregate>();
    const usageByApiKey = new Map<string, UsageAggregate>();
    const usageByApiKeyProvider = new Map<string, UsageAggregate>();
    const usageByApiKeyModel = new Map<string, UsageAggregate>();

    for (const request of allRequests) {
      const hour = request.createdAt.slice(0, 13) + ":00";
      const bucket = hourly.get(hour) ?? { requests: 0, errors: 0 };
      bucket.requests += 1;
      if (request.status === "error") bucket.errors += 1;
      hourly.set(hour, bucket);

      const apiKeyLabel = request.apiKeyId ? (keyNames.get(request.apiKeyId) ?? request.apiKeyId) : "Master / anonymous";
      for (const [map, key] of [
        [hourlyByProvider, request.provider],
        [hourlyByModel, request.modelAlias],
        [hourlyByApiKey, apiKeyLabel]
      ] as const) {
        const mapKey = `${hour}:${key}`;
        const value = map.get(mapKey) ?? { time: hour, key, requests: 0, errors: 0 };
        value.requests += 1;
        value.errors += request.status === "error" ? 1 : 0;
        map.set(mapKey, value);
      }

      costByProvider.set(request.provider, (costByProvider.get(request.provider) ?? 0) + (request.estimatedCost ?? 0));
      const latency = latencyByProvider.get(request.provider) ?? { latency: 0, count: 0 };
      latency.latency += request.latencyMs;
      latency.count += 1;
      latencyByProvider.set(request.provider, latency);

      const providerUsage = usageByProvider.get(request.provider) ?? emptyUsage(request.provider, request.provider, { provider: request.provider });
      addUsage(providerUsage, request);
      usageByProvider.set(request.provider, providerUsage);

      const modelUsage = usageByModel.get(request.modelAlias) ?? emptyUsage(request.modelAlias, request.modelAlias, {
        provider: request.provider,
        modelAlias: request.modelAlias
      });
      addUsage(modelUsage, request);
      usageByModel.set(request.modelAlias, modelUsage);

      const apiKeyId = request.apiKeyId ?? "master";
      const keyUsage = usageByApiKey.get(apiKeyId) ?? emptyUsage(apiKeyId, apiKeyLabel);
      addUsage(keyUsage, request);
      usageByApiKey.set(apiKeyId, keyUsage);

      const keyProviderId = `${apiKeyId}:${request.provider}`;
      const keyProviderUsage = usageByApiKeyProvider.get(keyProviderId) ?? emptyUsage(keyProviderId, apiKeyLabel, {
        provider: request.provider
      });
      addUsage(keyProviderUsage, request);
      usageByApiKeyProvider.set(keyProviderId, keyProviderUsage);

      const keyModelId = `${apiKeyId}:${request.modelAlias}`;
      const keyModelUsage = usageByApiKeyModel.get(keyModelId) ?? emptyUsage(keyModelId, apiKeyLabel, {
        modelAlias: request.modelAlias
      });
      addUsage(keyModelUsage, request);
      usageByApiKeyModel.set(keyModelId, keyModelUsage);
    }

    const providerUsage = Array.from(usageByProvider.values()).map(finalizeUsage).sort((a, b) => b.requests - a.requests);
    const modelUsage = Array.from(usageByModel.values()).map(finalizeUsage).sort((a, b) => b.requests - a.requests);
    const apiKeyUsage = Array.from(usageByApiKey.values()).map(finalizeUsage).sort((a, b) => b.requests - a.requests);
    const quotaRows = db.select().from(quotaSettings).all().filter((setting) => setting.enabled);
    const quotaWindows = quotaRows.map((setting) => {
      const windowStart = new Date(Date.now() - setting.windowHours * 60 * 60 * 1000).toISOString();
      const matching = allRequests.filter(
        (request) =>
          request.createdAt >= windowStart &&
          request.provider === setting.provider &&
          request.modelAlias === setting.modelAlias
      );
      const usedTokens = matching.reduce((total, request) => total + (request.inputTokens ?? 0) + (request.outputTokens ?? 0), 0);
      const requestPercent = setting.requestLimit ? matching.length / setting.requestLimit : null;
      const tokenPercent = setting.tokenLimit ? usedTokens / setting.tokenLimit : null;
      return {
        provider: setting.provider,
        modelAlias: setting.modelAlias,
        enabled: setting.enabled,
        windowHours: setting.windowHours,
        requests: matching.length,
        totalTokens: usedTokens,
        requestLimit: setting.requestLimit,
        tokenLimit: setting.tokenLimit,
        concurrencyLimit: setting.concurrencyLimit,
        requestPercent,
        tokenPercent,
        resetsAt: new Date(Date.now() + setting.windowHours * 60 * 60 * 1000).toISOString()
      };
    });
    const slowestProvider = providerUsage.reduce<UsageAggregate | null>(
      (slowest, usage) => (!slowest || usage.averageLatencyMs > slowest.averageLatencyMs ? usage : slowest),
      null
    );
    const mostErrors = [...providerUsage, ...modelUsage, ...apiKeyUsage].reduce<UsageAggregate | null>(
      (worst, usage) => (!worst || usage.errors > worst.errors ? usage : worst),
      null
    );

    return {
      requestsToday,
      requestsLast5h,
      totalRequests: allRequests.length,
      totalTokens,
      averageLatencyMs,
      errorRate: allRequests.length ? errors / allRequests.length : 0,
      estimatedCost: Number(allRequests.reduce((total, request) => total + (request.estimatedCost ?? 0), 0).toFixed(6)),
      activeProviders,
      requestsOverTime: Array.from(hourly.entries()).map(([time, value]) => ({ time, ...value })),
      requestsByProviderOverTime: Array.from(hourlyByProvider.values()),
      requestsByModelOverTime: Array.from(hourlyByModel.values()),
      requestsByApiKeyOverTime: Array.from(hourlyByApiKey.values()),
      costByProvider: Array.from(costByProvider.entries()).map(([provider, cost]) => ({ provider, cost })),
      latencyByProvider: Array.from(latencyByProvider.entries()).map(([provider, value]) => ({
        provider,
        latencyMs: Math.round(value.latency / value.count)
      })),
      usageByApiKey: apiKeyUsage,
      usageByApiKeyProvider: Array.from(usageByApiKeyProvider.values()).map(finalizeUsage),
      usageByApiKeyModel: Array.from(usageByApiKeyModel.values()).map(finalizeUsage),
      usageByModel: modelUsage,
      usageByProvider: providerUsage,
      quotaWindows,
      topStats: {
        mostUsedModel: modelUsage[0] ?? null,
        costliestProvider: [...providerUsage].sort((a, b) => b.estimatedCost - a.estimatedCost)[0] ?? null,
        slowestProvider,
        highestErrorSource: mostErrors
      }
    };
  });

  app.get("/admin/quota-settings", { preHandler: requireAdminAuth }, async () => {
    ensureQuotaSettings();
    const rows = db.select().from(quotaSettings).all();
    return {
      data: rows.map((row) => ({
        ...row,
        enabled: Boolean(row.enabled)
      }))
    };
  });

  app.patch("/admin/quota-settings", { preHandler: requireAdminAuth }, async (request) => {
    ensureQuotaSettings();
    const body = quotaPatchBody.parse(request.body);
    const now = new Date().toISOString();
    const rows = db.select().from(quotaSettings).all().filter((setting) => {
      if (setting.provider !== body.provider) return false;
      return body.modelAlias ? setting.modelAlias === body.modelAlias : true;
    });

    for (const row of rows) {
      db.update(quotaSettings)
        .set({
          enabled: body.enabled ?? row.enabled,
          windowHours: body.windowHours ?? row.windowHours,
          requestLimit: body.requestLimit === undefined ? row.requestLimit : body.requestLimit,
          tokenLimit: body.tokenLimit === undefined ? row.tokenLimit : body.tokenLimit,
          updatedAt: now
        })
        .where(eq(quotaSettings.id, row.id))
        .run();
    }

    return {
      data: db.select().from(quotaSettings).all().map((row) => ({
        ...row,
        enabled: Boolean(row.enabled)
      }))
    };
  });

  app.get("/admin/settings", { preHandler: requireAdminAuth }, async () => ({
    publicBaseUrl: env.PUBLIC_BASE_URL,
    apiPort: env.PORT,
    dashboardUrl: `http://localhost:${env.DASHBOARD_PORT}`,
    configSource: env.configPath,
    promptLogging: env.ENABLE_PROMPT_LOGGING,
    environmentHealth: {
      database: "ok",
      adminAuth: "disabled",
      publicApiAuth: "optional"
    }
  }));

  app.get("/admin/quota", { preHandler: requireAdminAuth }, async () => {
    const allRequests = db.select().from(requests).all();
    const quotaError = allRequests
      .filter((request) => {
        const text = `${request.errorCode ?? ""} ${request.errorMessage ?? ""}`.toLowerCase();
        return request.provider === "z-ai" && (request.status === "error") &&
          (text.includes("quota") || text.includes("limit") || text.includes("rate") || text.includes("429"));
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    const estimatedFiveHourResetAt = quotaError
      ? new Date(new Date(quotaError.createdAt).getTime() + 5 * 60 * 60 * 1000).toISOString()
      : null;

    return {
      provider: "z-ai",
      status: quotaError ? "quota_or_rate_limit_seen" : "no_recent_quota_error",
      source: "Z.ai Coding Plan docs and local gateway logs",
      exactProviderResetAt: null,
      estimatedFiveHourResetAt,
      weeklyResetAt: null,
      notes: [
        "Z.ai documents a dynamic 5-hour quota pool that resets 5 hours after consumption.",
        "The weekly Coding Plan limit resets every 7 days after subscription activation.",
        "The OpenAI-compatible API does not expose an exact subscription renewal timestamp to this gateway."
      ],
      lastQuotaEvent: quotaError
        ? {
            createdAt: quotaError.createdAt,
            modelAlias: quotaError.modelAlias,
            provider: quotaError.provider,
            realModel: quotaError.realModel,
            errorCode: quotaError.errorCode,
            errorMessage: quotaError.errorMessage,
            estimatedFiveHourResetAt
          }
        : null
    };
  });
}
