import type { ModelRouteConfig, ModelRouteTarget, ProviderConfig } from "@model-console/core";
import { GatewayError } from "@model-console/core/errors";
import { db } from "../db/client.js";
import { modelRoutes, providers } from "../db/schema.js";
import { isUncensoredAlias, stripUncensoredSuffix } from "../middleware/uncensored.js";

export interface ResolvedModelRoute {
  alias: string;
  attempts: ModelRouteTarget[];
}

// ── In-memory caches to avoid hitting SQLite on every request ──
let modelRouteCache: Map<string, ResolvedModelRoute> | null = null;
let providerConfigCache: Map<string, ProviderConfig> | null = null;

/**
 * Invalidate caches (call after config changes).
 */
export function invalidateRouteCache(): void {
  modelRouteCache = null;
  providerConfigCache = null;
}

function loadModelRouteCache(): Map<string, ResolvedModelRoute> {
  if (modelRouteCache) return modelRouteCache;
  const cache = new Map<string, ResolvedModelRoute>();
  for (const row of db.select().from(modelRoutes).all()) {
    if (!row.enabled) continue;
    const fallback = JSON.parse(row.fallbackJson || "[]") as ModelRouteTarget[];
    cache.set(row.alias, {
      alias: row.alias,
      attempts: [{ provider: row.provider, model: row.realModel }, ...fallback]
    });
  }
  modelRouteCache = cache;
  return cache;
}

function loadProviderConfigCache(): Map<string, ProviderConfig> {
  if (providerConfigCache) return providerConfigCache;
  const cache = new Map<string, ProviderConfig>();
  for (const row of db.select().from(providers).all()) {
    if (!row.enabled) continue;
    cache.set(row.name, {
      name: row.name,
      type: row.type as ProviderConfig["type"],
      baseUrl: row.baseUrl ?? undefined,
      enabled: row.enabled
    });
  }
  providerConfigCache = cache;
  return cache;
}

export function resolveModel(alias: string): ResolvedModelRoute {
  const cache = loadModelRouteCache();

  // Auto-resolve uncensored aliases (e.g. "glm5.2-u" → "glm5.2")
  const baseAlias = isUncensoredAlias(alias) ? stripUncensoredSuffix(alias) : alias;

  const route = cache.get(baseAlias);
  if (!route) {
    throw new GatewayError(`Model alias '${baseAlias}' is not configured`, {
      code: "model_not_found",
      statusCode: 404
    });
  }
  return route;
}

export function getProviderConfig(providerName: string): ProviderConfig {
  const cache = loadProviderConfigCache();
  const config = cache.get(providerName);
  if (!config) {
    throw new GatewayError(`Provider '${providerName}' is not configured or enabled`, {
      code: "provider_not_found",
      statusCode: 404
    });
  }
  return config;
}

export function listModelAliases(): ModelRouteConfig[] {
  return db.select().from(modelRoutes).all().map((route) => ({
    alias: route.alias,
    provider: route.provider,
    model: route.realModel,
    enabled: route.enabled,
    createdAt: route.createdAt,
    fallback: JSON.parse(route.fallbackJson || "[]") as ModelRouteTarget[],
    contextLength: route.contextLength,
    maxOutputTokens: route.maxOutputTokens
  }));
}
