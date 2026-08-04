import { lt, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db/client.js";
import { healthProbes, providers, modelRoutes, requests } from "../db/schema.js";
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

const PROBE_MESSAGE = "Say 'ok' in exactly those two characters.";
const MAX_PROBE_TOKENS = 5;
const PROBE_TIMEOUT_MS = 15_000;

interface ProbeResult {
  provider: string;
  status: "operational" | "degraded" | "incident";
  latencyMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

async function probeProvider(
  providerName: string,
  providerType: string,
  providerBaseUrl: string | null
): Promise<ProbeResult> {
  const enabledRoutes = db.select().from(modelRoutes).all().filter((r) => r.provider === providerName && r.enabled);
  const latestSuccessByAlias = new Map<string, string>();
  for (const request of db.select().from(requests).all()) {
    if (request.provider !== providerName || request.status !== "success") continue;
    const current = latestSuccessByAlias.get(request.modelAlias);
    if (!current || request.createdAt > current) latestSuccessByAlias.set(request.modelAlias, request.createdAt);
  }
  const route = enabledRoutes.sort((a, b) =>
    (latestSuccessByAlias.get(b.alias) ?? "").localeCompare(latestSuccessByAlias.get(a.alias) ?? "")
  )[0];
  if (!route) {
    return { provider: providerName, status: "incident", latencyMs: null, statusCode: null, errorMessage: "No enabled model route" };
  }
  const adapter = adapters[providerType] ?? adapters[providerName];
  if (!adapter) {
    return { provider: providerName, status: "incident", latencyMs: null, statusCode: null, errorMessage: "No adapter registered" };
  }
  const start = Date.now();
  try {
    await Promise.race([
      adapter.complete(
        {
          modelAlias: route.alias,
          messages: [{ role: "user", content: PROBE_MESSAGE }],
          maxTokens: MAX_PROBE_TOKENS,
          stream: false
        },
        { provider: providerName, model: route.realModel },
        {
          name: providerName,
          type: providerType as "openai" | "openrouter" | "gemini" | "anthropic" | "custom",
          baseUrl: providerBaseUrl ?? undefined,
          enabled: true
        }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Probe timeout")), PROBE_TIMEOUT_MS)
      )
    ]);
    return {
      provider: providerName,
      status: "operational",
      latencyMs: Date.now() - start,
      statusCode: 200,
      errorMessage: null
    };
  } catch (error) {
    return {
      provider: providerName,
      status: "incident",
      latencyMs: Date.now() - start,
      statusCode: null,
      errorMessage: error instanceof Error ? error.message : "Probe failed"
    };
  }
}

function statusFromProbes(probes: ProbeResult[]): "operational" | "degraded" | "incident" {
  if (!probes.length) return "incident";
  const incidents = probes.filter((p) => p.status === "incident").length;
  if (incidents === probes.length) return "incident";
  if (incidents > 0) return "degraded";
  return "operational";
}

export async function healthProbeRoutes(app: FastifyInstance): Promise<void> {
  // Get current health (latest probe per provider + recent log-inferred status)
  app.get("/admin/health", { preHandler: requireAdminAuth }, async () => {
    const allProviders = db.select().from(providers).all();
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    const recentProbes = allProviders.map((p) => {
      const latest = db.select().from(healthProbes)
        .where(eq(healthProbes.provider, p.name))
        .orderBy(desc(healthProbes.createdAt))
        .limit(1)
        .all();
      return { provider: p, latest: latest[0] ?? null };
    });

    return {
      overall: statusFromProbes(
        recentProbes
          .filter((rp) => rp.latest && new Date(rp.latest.createdAt) > new Date(tenMinAgo))
          .map((rp) => ({
            provider: rp.provider.name,
            status: rp.latest!.status as "operational" | "degraded" | "incident",
            latencyMs: rp.latest!.latencyMs,
            statusCode: rp.latest!.statusCode,
            errorMessage: rp.latest!.errorMessage
          }))
      ),
      providers: recentProbes.map((rp) => ({
        name: rp.provider.name,
        type: rp.provider.type,
        enabled: rp.provider.enabled,
        lastProbe: rp.latest
          ? {
              status: rp.latest.status,
              latencyMs: rp.latest.latencyMs,
              statusCode: rp.latest.statusCode,
              errorMessage: rp.latest.errorMessage,
              createdAt: rp.latest.createdAt,
              fresh: new Date(rp.latest.createdAt) > new Date(tenMinAgo)
            }
          : null
      })),
      probedAt: now.toISOString()
    };
  });

  // Trigger active probe of all enabled providers
  app.post("/admin/health/probe", { preHandler: requireAdminAuth }, async () => {
    const allProviders = db.select().from(providers).all().filter((p) => p.enabled);
    const results: ProbeResult[] = [];

    // Probe sequentially to avoid hammering all providers simultaneously
    for (const provider of allProviders) {
      const result = await probeProvider(provider.name, provider.type, provider.baseUrl);
      results.push(result);

      const now = new Date().toISOString();
      db.insert(healthProbes).values({
        id: nanoid(),
        provider: result.provider,
        status: result.status,
        latencyMs: result.latencyMs,
        statusCode: result.statusCode,
        errorMessage: result.errorMessage,
        createdAt: now
      }).run();
    }

    // Clean up probes older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.delete(healthProbes).where(lt(healthProbes.createdAt, sevenDaysAgo)).run();

    return {
      overall: statusFromProbes(results),
      results,
      probedAt: new Date().toISOString()
    };
  });

  // Get probe history for charts
  app.get("/admin/health/history", { preHandler: requireAdminAuth }, async () => {
    const hours = 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const allProbes = db.select().from(healthProbes).all().filter((p) => p.createdAt >= since);

    const byProvider = new Map<string, typeof allProbes>();
    for (const probe of allProbes) {
      const arr = byProvider.get(probe.provider) ?? [];
      arr.push(probe);
      byProvider.set(probe.provider, arr);
    }

    return {
      hours,
      history: Array.from(byProvider.entries()).map(([provider, probes]) => ({
        provider,
        probes: probes
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((p) => ({
            time: p.createdAt,
            status: p.status,
            latencyMs: p.latencyMs,
            errorMessage: p.errorMessage
          }))
      }))
    };
  });
}

const AUTO_PROBE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let autoProbeTimer: NodeJS.Timeout | null = null;

export function startAutoProbe(): void {
  if (autoProbeTimer) return;

  // Initial probe after 10s startup grace
  setTimeout(async () => {
    try {
      const allProviders = db.select().from(providers).all().filter((p) => p.enabled);
      for (const provider of allProviders) {
        const result = await probeProvider(provider.name, provider.type, provider.baseUrl);
        const now = new Date().toISOString();
        db.insert(healthProbes).values({
          id: nanoid(),
          provider: result.provider,
          status: result.status,
          latencyMs: result.latencyMs,
          statusCode: result.statusCode,
          errorMessage: result.errorMessage,
          createdAt: now
        }).run();
      }
    } catch { /* silent — probe failures are non-fatal */ }
  }, 10_000);

  // Recurring interval
  autoProbeTimer = setInterval(async () => {
    try {
      const allProviders = db.select().from(providers).all().filter((p) => p.enabled);
      for (const provider of allProviders) {
        const result = await probeProvider(provider.name, provider.type, provider.baseUrl);
        const now = new Date().toISOString();
        db.insert(healthProbes).values({
          id: nanoid(),
          provider: result.provider,
          status: result.status,
          latencyMs: result.latencyMs,
          statusCode: result.statusCode,
          errorMessage: result.errorMessage,
          createdAt: now
        }).run();
      }
      // Cleanup old probes
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      db.delete(healthProbes).where(lt(healthProbes.createdAt, sevenDaysAgo)).run();
    } catch { /* silent */ }
  }, AUTO_PROBE_INTERVAL_MS);
}
