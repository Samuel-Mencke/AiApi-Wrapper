import fs from "node:fs";
import { nanoid } from "nanoid";
import YAML from "yaml";
import { eq } from "drizzle-orm";
import type { ModelRouteConfig, ModelRouteTarget, ProviderConfig } from "@ai-gateway/core";
import { db } from "../db/client.js";
import { modelRoutes, providers, quotaSettings } from "../db/schema.js";
import { env } from "../env.js";

interface ProvidersFile {
  providers?: Record<string, Omit<ProviderConfig, "name">>;
  models?: Record<string, ModelRouteTarget & { fallback?: ModelRouteTarget[]; enabled?: boolean }>;
}

export function readProvidersFile(): ProvidersFile {
  if (!fs.existsSync(env.configPath)) {
    return {};
  }

  return (YAML.parse(fs.readFileSync(env.configPath, "utf8")) ?? {}) as ProvidersFile;
}

export function getConfiguredProviders(): ProviderConfig[] {
  const file = readProvidersFile();
  return Object.entries(file.providers ?? {}).map(([name, provider]) => ({
    name,
    type: provider.type,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled ?? true
  }));
}

export function getConfiguredModels(): ModelRouteConfig[] {
  const file = readProvidersFile();
  return Object.entries(file.models ?? {}).map(([alias, route]) => ({
    alias,
    provider: route.provider,
    model: route.model,
    baseUrl: route.baseUrl,
    enabled: route.enabled ?? true,
    fallback: route.fallback ?? []
  }));
}

export function syncConfigToDatabase(): void {
  const now = new Date().toISOString();
  for (const provider of getConfiguredProviders()) {
    const existing = db.select().from(providers).where(eq(providers.name, provider.name)).get();
    if (!existing) {
      db.insert(providers).values({
        id: nanoid(),
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        createdAt: now
      }).run();
    }
  }

  for (const route of getConfiguredModels()) {
    const existing = db.select().from(modelRoutes).where(eq(modelRoutes.alias, route.alias)).get();
    if (!existing) {
      db.insert(modelRoutes).values({
        id: nanoid(),
        alias: route.alias,
        provider: route.provider,
        realModel: route.model,
        fallbackJson: JSON.stringify(route.fallback),
        enabled: route.enabled,
        createdAt: now
      }).run();
    }
  }

  for (const route of getConfiguredModels()) {
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
        concurrencyLimit: zAiConcurrencyLimit(route.model),
        createdAt: now,
        updatedAt: now
      }).run();
    }
  }
}

function zAiConcurrencyLimit(model: string): number | null {
  const normalized = model.toLowerCase();
  if (normalized === "glm-5.1") return 10;
  if (normalized === "glm-5-turbo") return 1;
  if (normalized === "glm-4.6") return 3;
  if (normalized === "glm-4.7") return 2;
  return null;
}

export function getProviderApiKey(provider: string): string | undefined {
  if (provider === "openai") return env.OPENAI_API_KEY;
  if (provider === "openrouter") return env.OPENROUTER_API_KEY;
  if (provider === "gemini") return env.GEMINI_API_KEY;
  if (provider === "anthropic") return env.ANTHROPIC_API_KEY;
  if (provider === "z-ai") return env.ZAI_API_KEY;
  return undefined;
}
