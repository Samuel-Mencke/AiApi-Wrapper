import { getProviderApiKey } from "../config/providers.js";
import { listModelAliases } from "../router/resolve-model.js";
import { executeWithFallback } from "../router/fallback.js";



const cache = new Map<string, { expiresAt: number; status: "verified" | "failed"; message: string; latencyMs: number }>();

const defaultModelCapabilities = {
  supportsReasoning: false,
  exposesReasoningSummary: false,
  supportsTools: true,
  supportsRichBlocks: false
};

function capabilitiesFor(model: { provider: string; model: string }) {
  const realModel = model.model.toLowerCase();
  const isGlm = model.provider === "z-ai" || realModel.startsWith("glm");
  return {
    ...defaultModelCapabilities,
    supportsReasoning: isGlm,
    exposesReasoningSummary: isGlm,
    supportsRichBlocks: true
  };
}

export function listChatModels() {
  // Show ALL enabled models — don't hide models whose provider key may be
  // empty, because the key might be loaded from .env at runtime or the
  // model might work through fallback chains.
  const baseModels = listModelAliases()
    .filter((model) => model.enabled)
    .filter((model) => {
      const providerKey = getProviderApiKey(model.provider);
      return Boolean(providerKey) || model.provider === "chatgpt-web" || model.provider === "z-ai";
    });

  // Build the list with -u variants only
  const skipAutoVariants = new Set(["local-test"]);
  const allModels = [...baseModels];
  for (const m of baseModels) {
    if (skipAutoVariants.has(m.alias)) continue;
    allModels.push({ ...m, alias: `${m.alias}-u` });
  }

  return allModels.map((model) => {
      const cached = cache.get(model.alias);
      return {
        alias: model.alias,
        provider: model.provider,
        realModel: model.model,
        fallbackCount: model.fallback.length,
        status: cached && cached.expiresAt > Date.now() ? cached.status : "untested",
        statusMessage: cached && cached.expiresAt > Date.now() ? cached.message : null,
        latencyMs: cached && cached.expiresAt > Date.now() ? cached.latencyMs : null,
        modelCapabilities: capabilitiesFor(model)
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
    const execution = await executeWithFallback(
      {
        modelAlias: alias,
        messages: [{ role: "user", content: "Say 'test ok' in exactly those two words." }],
        maxTokens: 10,
        stream: false
      },
      null
    );
    const result = execution.response;
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
