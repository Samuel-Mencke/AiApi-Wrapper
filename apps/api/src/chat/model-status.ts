import type { ProviderAdapter } from "../providers/types.js";
import { anthropicAdapter } from "../providers/anthropic.js";
import { getProviderApiKey } from "../config/providers.js";
import { geminiAdapter } from "../providers/gemini.js";
import { createOpenAiCompatibleAdapter } from "../providers/openai-compatible.js";
import { openAiAdapter } from "../providers/openai.js";
import { openRouterAdapter } from "../providers/openrouter.js";
import { getProviderConfig, listModelAliases, resolveModel } from "../router/resolve-model.js";

const adapters: Record<string, ProviderAdapter> = {
  openai: openAiAdapter,
  openrouter: openRouterAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  custom: createOpenAiCompatibleAdapter("custom")
};

const cache = new Map<string, { expiresAt: number; status: "verified" | "failed"; message: string; latencyMs: number }>();

const defaultModelCapabilities = {
  supportsReasoning: false,
  exposesReasoningSummary: false,
  supportsTools: true,
  supportsRichBlocks: false
};

export function listChatModels() {
  return listModelAliases()
    .filter((model) => model.enabled)
    .filter((model) => Boolean(getProviderApiKey(model.provider)))
    .map((model) => {
      const cached = cache.get(model.alias);
      return {
        alias: model.alias,
        provider: model.provider,
        realModel: model.model,
        fallbackCount: model.fallback.length,
        status: cached && cached.expiresAt > Date.now() ? cached.status : "untested",
        statusMessage: cached && cached.expiresAt > Date.now() ? cached.message : null,
        latencyMs: cached && cached.expiresAt > Date.now() ? cached.latencyMs : null,
        modelCapabilities: defaultModelCapabilities
      };
    });
}

export async function testChatModel(alias: string) {
  const cached = cache.get(alias);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }
  const start = Date.now();
  try {
    const route = resolveModel(alias);
    const first = route.attempts[0];
    if (!first) throw new Error(`No target for alias '${alias}'`);
    const providerConfig = getProviderConfig(first.provider);
    const adapter = adapters[providerConfig.type] ?? adapters[providerConfig.name];
    if (!adapter) throw new Error(`No adapter for provider type '${providerConfig.type}'`);
    const result = await adapter.complete(
      {
        modelAlias: alias,
        messages: [{ role: "user", content: "Say 'test ok' in exactly those two words." }],
        maxTokens: 10,
        stream: false
      },
      first,
      providerConfig
    );
    const value = {
      expiresAt: Date.now() + 5 * 60_000,
      status: "verified" as const,
      message: typeof result.content === "string" ? result.content.slice(0, 200) : "Model returned content",
      latencyMs: Date.now() - start
    };
    cache.set(alias, value);
    return value;
  } catch (error) {
    const value = {
      expiresAt: Date.now() + 90_000,
      status: "failed" as const,
      message: error instanceof Error ? error.message : "Model test failed",
      latencyMs: Date.now() - start
    };
    cache.set(alias, value);
    return value;
  }
}
