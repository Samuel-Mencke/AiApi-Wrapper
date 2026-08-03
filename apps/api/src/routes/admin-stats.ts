import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "../db/client.js";
import { apiKeys, modelRoutes, providers, quotaSettings, requests, storedResponses } from "../db/schema.js";
import { env } from "../env.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { CHAT_API_KEY_ID, CHAT_API_KEY_NAME, ensureInternalChatApiKey } from "../chat/internal-api-key.js";
import { isProviderResetActive, parseProviderResetAt } from "./provider-reset.js";

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

const PROVIDER_QUOTA_ALIAS = "__provider__";

type RequestRow = typeof requests.$inferSelect;
type QuotaSettingRow = typeof quotaSettings.$inferSelect;

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
  const allProviders = db.select().from(providers).all();
  const routes = db.select().from(modelRoutes).all();
  const existingQuotaRows = db.select().from(quotaSettings).all();
  for (const provider of allProviders) {
    const existing = existingQuotaRows.find(
      (setting) => setting.provider === provider.name && setting.modelAlias === PROVIDER_QUOTA_ALIAS
    );
    if (!existing) {
      const providerRoutes = routes.filter((route) => route.provider === provider.name);
      const legacyEnabled = existingQuotaRows.some(
        (setting) => setting.provider === provider.name && setting.modelAlias !== PROVIDER_QUOTA_ALIAS && setting.enabled
      );
      db.insert(quotaSettings).values({
        id: nanoid(),
        provider: provider.name,
        modelAlias: PROVIDER_QUOTA_ALIAS,
        enabled: legacyEnabled,
        windowHours: commonWindowHours(providerRoutes.map((route) => route.alias), existingQuotaRows),
        requestLimit: commonLimit(providerRoutes.map((route) => route.alias), existingQuotaRows, "requestLimit"),
        tokenLimit: commonLimit(providerRoutes.map((route) => route.alias), existingQuotaRows, "tokenLimit"),
        concurrencyLimit: null,
        createdAt: now,
        updatedAt: now
      }).run();
    }
  }

  for (const route of routes) {
    const existing = existingQuotaRows.find((setting) => setting.modelAlias === route.alias);
    if (!existing) {
      db.insert(quotaSettings).values({
        id: nanoid(),
        provider: route.provider,
        modelAlias: route.alias,
        enabled: route.provider === "z-ai" && route.alias === "glm-4.5",
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

function commonWindowHours(modelAliases: string[], rows: Array<typeof quotaSettings.$inferSelect>): number {
  const values = rows
    .filter((row) => modelAliases.includes(row.modelAlias))
    .map((row) => row.windowHours);
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : 5;
}

function commonLimit(
  modelAliases: string[],
  rows: Array<typeof quotaSettings.$inferSelect>,
  key: "requestLimit" | "tokenLimit"
): number | null {
  const values = rows
    .filter((row) => modelAliases.includes(row.modelAlias))
    .map((row) => row[key]);
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : null;
}

function apiKeyNameMap(): Map<string, string> {
  return new Map(db.select().from(apiKeys).all().map((key) => [key.id, key.name]));
}

export async function adminStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/stats", { preHandler: requireAdminAuth }, async () => {
    ensureQuotaSettings();
    ensureInternalChatApiKey();
    const allRequests: RequestRow[] = db.select().from(requests).all();
    const allResponses = db.select().from(storedResponses).all();
    const activeProviders = db.select().from(providers).all().filter((provider) => provider.enabled).length;
    const keyNames = apiKeyNameMap();
    const today = startOfToday();
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const requestsToday = allRequests.filter((request) => request.createdAt >= today).length;
    const responsesToday = allResponses.filter((response) => response.createdAt >= today && !response.deletedAt).length;
    const requestsLast5h = allRequests.filter((request) => request.createdAt >= fiveHoursAgo).length;
    const errors = allRequests.filter((request) => request.status === "error").length;
    const averageLatencyMs = allRequests.length
      ? Math.round(allRequests.reduce((total, request) => total + request.latencyMs, 0) / allRequests.length)
      : 0;
    const totalTokens = allRequests.reduce((total, request) => total + (request.inputTokens ?? 0) + (request.outputTokens ?? 0), 0);

    const hourly = new Map<string, {
      requests: number;
      errors: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCost: number;
      latencyTotal: number;
    }>();
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
      const inputTokens = request.inputTokens ?? 0;
      const outputTokens = request.outputTokens ?? 0;
      const totalRequestTokens = inputTokens + outputTokens;
      const bucket = hourly.get(hour) ?? {
        requests: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        latencyTotal: 0
      };
      bucket.requests += 1;
      if (request.status === "error") bucket.errors += 1;
      bucket.inputTokens += inputTokens;
      bucket.outputTokens += outputTokens;
      bucket.totalTokens += totalRequestTokens;
      bucket.estimatedCost += request.estimatedCost ?? 0;
      bucket.latencyTotal += request.latencyMs;
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
    if (!usageByApiKey.has(CHAT_API_KEY_ID)) {
      usageByApiKey.set(CHAT_API_KEY_ID, emptyUsage(CHAT_API_KEY_ID, keyNames.get(CHAT_API_KEY_ID) ?? CHAT_API_KEY_NAME));
    }
    const chatUsage = finalizeUsage(usageByApiKey.get(CHAT_API_KEY_ID)!);
    const apiKeyUsage = Array.from(usageByApiKey.values()).map(finalizeUsage).sort((a, b) => b.requests - a.requests);
    const allQuotaRows: QuotaSettingRow[] = db.select().from(quotaSettings).all();
    const providerQuotaProviders = new Set(
      allQuotaRows
        .filter((setting) => setting.modelAlias === PROVIDER_QUOTA_ALIAS)
        .map((setting) => setting.provider)
    );
    const quotaRows = allQuotaRows.filter((setting) => {
      if (!setting.enabled) return false;
      if (setting.modelAlias === PROVIDER_QUOTA_ALIAS) return true;
      return !providerQuotaProviders.has(setting.provider);
    });
    const quotaWindows = quotaRows.map((setting) => {
      const windowStart = new Date(Date.now() - setting.windowHours * 60 * 60 * 1000).toISOString();
      const matching = allRequests.filter(
        (request) =>
          request.createdAt >= windowStart &&
          request.provider === setting.provider &&
          (setting.modelAlias === PROVIDER_QUOTA_ALIAS || request.modelAlias === setting.modelAlias)
      );
      const usedTokens = matching.reduce((total, request) => total + (request.inputTokens ?? 0) + (request.outputTokens ?? 0), 0);
      const requestPercent = setting.requestLimit ? matching.length / setting.requestLimit : null;
      const tokenPercent = setting.tokenLimit ? usedTokens / setting.tokenLimit : null;
      return {
        provider: setting.provider,
        modelAlias: setting.modelAlias === PROVIDER_QUOTA_ALIAS ? "All models" : setting.modelAlias,
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
    // === Model Performance Scoring ===
    // Builds a per-model performance profile with normalized 0-100 scores.
    // Metrics: throughput (tokens/sec), latency, cost efficiency, reliability, total volume.
    const modelPerformance = modelUsage
      .filter((m) => m.requests > 0)
      .map((m) => {
        const latencySec = m.averageLatencyMs / 1000;
        const throughput = latencySec > 0 ? m.outputTokens / latencySec : 0; // output tokens per second
        const costPer1k = m.totalTokens > 0 ? (m.estimatedCost / m.totalTokens) * 1000 : 0;
        const reliability = 1 - m.errorRate;
        return {
          modelAlias: m.modelAlias ?? m.label,
          provider: m.provider ?? "",
          requests: m.requests,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          totalTokens: m.totalTokens,
          estimatedCost: m.estimatedCost,
          averageLatencyMs: m.averageLatencyMs,
          throughput,         // tokens/sec
          costPer1kTokens: costPer1k,
          errorRate: m.errorRate,
          reliability         // 0-1
        };
      });

    // Normalize each metric to 0-100 across the set (higher = better).
    // throughput, reliability, totalTokens → higher is better
    // latency, costPer1k, errorRate → lower is better (invert)
    if (modelPerformance.length > 0) {
      const maxThroughput = Math.max(...modelPerformance.map(m => m.throughput));
      const maxLatency = Math.max(...modelPerformance.map(m => m.averageLatencyMs));
      const maxCost = Math.max(...modelPerformance.map(m => m.costPer1kTokens));
      const maxTokens = Math.max(...modelPerformance.map(m => m.totalTokens));
      const maxErrors = Math.max(...modelPerformance.map(m => m.errorRate));

      for (const m of modelPerformance) {
        const throughputScore = maxThroughput > 0 ? (m.throughput / maxThroughput) * 100 : 0;
        const latencyScore = maxLatency > 0 ? (1 - m.averageLatencyMs / maxLatency) * 100 : 100;
        const costScore = maxCost > 0 ? (1 - m.costPer1kTokens / maxCost) * 100 : 100;
        const reliabilityScore = maxErrors > 0 ? (1 - m.errorRate / maxErrors) * 100 : 100;
        const volumeScore = maxTokens > 0 ? (m.totalTokens / maxTokens) * 100 : 0;

        // Composite: weighted average emphasizing throughput & reliability
        const composite = Math.round(
          throughputScore * 0.30 +
          latencyScore * 0.20 +
          reliabilityScore * 0.25 +
          costScore * 0.15 +
          volumeScore * 0.10
        );

        (m as any).scores = {
          throughput: Math.round(throughputScore),
          latency: Math.round(latencyScore),
          cost: Math.round(costScore),
          reliability: Math.round(reliabilityScore),
          volume: Math.round(volumeScore),
          composite
        };
      }
      modelPerformance.sort((a, b) => (b as any).scores.composite - (a as any).scores.composite);
    }

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
      responsesToday,
      requestsLast5h,
      totalRequests: allRequests.length,
      totalResponses: allResponses.filter((response) => !response.deletedAt).length,
      responsesByStatus: Object.fromEntries(
        [...new Set(allResponses.filter((response) => !response.deletedAt).map((response) => response.status))]
          .map((status) => [status, allResponses.filter((response) => !response.deletedAt && response.status === status).length])
      ),
      totalTokens,
      averageLatencyMs,
      errorRate: allRequests.length ? errors / allRequests.length : 0,
      estimatedCost: Number(allRequests.reduce((total, request) => total + (request.estimatedCost ?? 0), 0).toFixed(6)),
      activeProviders,
      requestsOverTime: Array.from(hourly.entries()).map(([time, value]) => ({
        time,
        requests: value.requests,
        errors: value.errors,
        inputTokens: value.inputTokens,
        outputTokens: value.outputTokens,
        totalTokens: value.totalTokens,
        estimatedCost: Number(value.estimatedCost.toFixed(6)),
        averageLatencyMs: value.requests ? Math.round(value.latencyTotal / value.requests) : 0
      })),
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
      modelPerformance,
      chatUsage,
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
    const rows: QuotaSettingRow[] = db.select().from(quotaSettings).all();
    return {
      data: rows.map((row: QuotaSettingRow) => ({
        ...row,
        enabled: Boolean(row.enabled)
      }))
    };
  });

  app.patch("/admin/quota-settings", { preHandler: requireAdminAuth }, async (request) => {
    ensureQuotaSettings();
    const body = quotaPatchBody.parse(request.body);
    const now = new Date().toISOString();
    let rows: QuotaSettingRow[] = db.select().from(quotaSettings).all().filter((setting: QuotaSettingRow) => {
      if (setting.provider !== body.provider) return false;
      return body.modelAlias ? setting.modelAlias === body.modelAlias : setting.modelAlias === PROVIDER_QUOTA_ALIAS;
    });

    if (!body.modelAlias && !rows.length) {
      db.insert(quotaSettings).values({
        id: nanoid(),
        provider: body.provider,
        modelAlias: PROVIDER_QUOTA_ALIAS,
        enabled: body.enabled ?? false,
        windowHours: body.windowHours ?? 5,
        requestLimit: body.requestLimit ?? null,
        tokenLimit: body.tokenLimit ?? null,
        concurrencyLimit: null,
        createdAt: now,
        updatedAt: now
      }).run();
      rows = db.select().from(quotaSettings).all().filter((setting: QuotaSettingRow) =>
        setting.provider === body.provider && setting.modelAlias === PROVIDER_QUOTA_ALIAS
      );
    }

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
      data: db.select().from(quotaSettings).all().map((row: QuotaSettingRow) => ({
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
    const allRequests: RequestRow[] = db.select().from(requests).all();
    const quotaError = allRequests
      .filter((request: RequestRow) => {
        const text = `${request.errorCode ?? ""} ${request.errorMessage ?? ""}`.toLowerCase();
        return request.provider === "z-ai" && (request.status === "error") &&
          (text.includes("quota") || text.includes("limit") || text.includes("rate") || text.includes("429"));
      })
      .sort((a: RequestRow, b: RequestRow) => b.createdAt.localeCompare(a.createdAt))[0];

    const exactProviderResetAt = parseProviderResetAt(quotaError?.errorMessage);
    const estimatedFiveHourResetAt = quotaError && !exactProviderResetAt
      ? new Date(new Date(quotaError.createdAt).getTime() + 5 * 60 * 60 * 1000).toISOString()
      : null;
    const activeResetAt = exactProviderResetAt ?? estimatedFiveHourResetAt;
    const active = isProviderResetActive(activeResetAt);

    return {
      provider: "z-ai",
      status: active ? "quota_active" : quotaError ? "quota_event_expired" : "no_recent_quota_error",
      active,
      source: "Z.ai provider error and local gateway logs",
      exactProviderResetAt,
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
            exactProviderResetAt,
            estimatedFiveHourResetAt
          }
        : null
    };
  });
}
