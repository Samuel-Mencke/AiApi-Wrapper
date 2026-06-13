import { eq } from "drizzle-orm";
import type { ModelRouteConfig, ModelRouteTarget, ProviderConfig } from "@ai-gateway/core";
import { GatewayError } from "@ai-gateway/core/errors";
import { db } from "../db/client.js";
import { modelRoutes, providers } from "../db/schema.js";

export interface ResolvedModelRoute {
  alias: string;
  attempts: ModelRouteTarget[];
}

export function resolveModel(alias: string): ResolvedModelRoute {
  const row = db.select().from(modelRoutes).where(eq(modelRoutes.alias, alias)).get();
  if (!row || !row.enabled) {
    throw new GatewayError(`Model alias '${alias}' is not configured`, {
      code: "model_not_found",
      statusCode: 404
    });
  }

  const fallback = JSON.parse(row.fallbackJson || "[]") as ModelRouteTarget[];
  return {
    alias,
    attempts: [{ provider: row.provider, model: row.realModel }, ...fallback]
  };
}

export function getProviderConfig(providerName: string): ProviderConfig {
  const row = db.select().from(providers).where(eq(providers.name, providerName)).get();
  if (!row || !row.enabled) {
    throw new GatewayError(`Provider '${providerName}' is not configured or enabled`, {
      code: "provider_not_found",
      statusCode: 404
    });
  }
  return {
    name: row.name,
    type: row.type as ProviderConfig["type"],
    baseUrl: row.baseUrl ?? undefined,
    enabled: row.enabled
  };
}

export function listModelAliases(): ModelRouteConfig[] {
  return db.select().from(modelRoutes).all().map((route) => ({
    alias: route.alias,
    provider: route.provider,
    model: route.realModel,
    enabled: route.enabled,
    createdAt: route.createdAt,
    fallback: JSON.parse(route.fallbackJson || "[]") as ModelRouteTarget[]
  }));
}
