/**
 * Context-limit resolution for model aliases.
 *
 * Resolution order (first match wins):
 *   1. DB override (model_routes.context_length) — set via dashboard/admin
 *   2. YAML override (providers.yml → models.<alias>.context_length)
 *   3. Built-in registry (known models)
 *   4. Provider auto-probe cache (OpenRouter /models, fetched periodically)
 *   5. Sensible default per provider family
 */

/** Fetched upstream model info (cached). */
interface ProbedModel {
  contextLength: number;
  maxOutputTokens?: number;
  fetchedAt: number;
}

const PROBE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const probeCache = new Map<string, ProbedModel>(); // key: `${provider}:${realModel}`
let probeInProgress: Promise<void> | null = null;

/**
 * Built-in registry of known context windows.
 * Keyed by lowercase real model name (partial match).
 */
const REGISTRY: Array<{ pattern: string; context: number; maxOutput?: number }> = [
  // Z.AI / GLM
  { pattern: "glm-5.2", context: 200_000, maxOutput: 16_384 },
  { pattern: "glm-5.1", context: 200_000, maxOutput: 16_384 },
  { pattern: "glm-5-turbo", context: 200_000, maxOutput: 16_384 },
  { pattern: "glm-5", context: 128_000, maxOutput: 8_192 },
  { pattern: "glm-4.7", context: 128_000, maxOutput: 8_192 },
  { pattern: "glm-4.6", context: 128_000, maxOutput: 8_192 },
  { pattern: "glm-4.5", context: 128_000, maxOutput: 8_192 },
  // OpenAI
  { pattern: "gpt-5.5", context: 400_000, maxOutput: 32_768 },
  { pattern: "gpt-5", context: 256_000, maxOutput: 16_384 },
  { pattern: "gpt-4.1", context: 1_000_000, maxOutput: 32_768 },
  { pattern: "o4", context: 200_000, maxOutput: 100_000 },
  { pattern: "o3", context: 200_000, maxOutput: 100_000 },
  // Anthropic
  { pattern: "claude-opus-4", context: 200_000, maxOutput: 32_000 },
  { pattern: "claude-sonnet-4", context: 200_000, maxOutput: 16_000 },
  { pattern: "claude-3-5", context: 200_000, maxOutput: 8_192 },
  // Gemini
  { pattern: "gemini-2.5", context: 1_000_000, maxOutput: 65_536 },
  { pattern: "gemini-2.0", context: 1_000_000, maxOutput: 8_192 },
  // Qwen (OpenRouter)
  { pattern: "qwen3-coder", context: 256_000, maxOutput: 32_768 },
  { pattern: "qwen3", context: 128_000, maxOutput: 8_192 },
  // DeepSeek
  { pattern: "deepseek-v3", context: 128_000, maxOutput: 8_192 },
  { pattern: "deepseek-r1", context: 128_000, maxOutput: 32_768 }
];

const DEFAULT_CONTEXT = 128_000;

/**
 * Lookup the built-in registry by real model name.
 */
function lookupRegistry(realModel: string): { context: number; maxOutput?: number } | undefined {
  const lower = realModel.toLowerCase();
  // Try exact prefix match — longest pattern first for specificity
  const sorted = [...REGISTRY].sort((a, b) => b.pattern.length - a.pattern.length);
  for (const entry of sorted) {
    if (lower.startsWith(entry.pattern)) {
      return { context: entry.context, maxOutput: entry.maxOutput };
    }
  }
  return undefined;
}

/**
 * Resolve context length for a model, checking all sources in priority order.
 *
 * @param realModel  Upstream model name (e.g. "glm-5.2")
 * @param provider   Provider name (e.g. "z-ai")
 * @param dbOverride Optional DB-stored override (from model_routes.context_length)
 * @param yamlOverride Optional YAML-stored override
 */
export function resolveContextLength(
  realModel: string,
  provider: string,
  dbOverride?: number | null,
  yamlOverride?: number
): number {
  // 1. DB override (highest priority — admin set it explicitly)
  if (dbOverride && dbOverride > 0) return dbOverride;

  // 2. YAML override
  if (yamlOverride && yamlOverride > 0) return yamlOverride;

  // 3. Probe cache (fresh data from upstream)
  const probeKey = `${provider}:${realModel}`;
  const probed = probeCache.get(probeKey);
  if (probed && Date.now() - probed.fetchedAt < PROBE_TTL_MS) {
    return probed.contextLength;
  }

  // 4. Registry
  const registryHit = lookupRegistry(realModel);
  if (registryHit) return registryHit.context;

  // 5. Default
  return DEFAULT_CONTEXT;
}

/**
 * Resolve max output tokens for a model (best-effort).
 */
export function resolveMaxOutputTokens(
  realModel: string,
  provider: string,
  yamlMaxOutput?: number
): number | undefined {
  if (yamlMaxOutput && yamlMaxOutput > 0) return yamlMaxOutput;

  const probeKey = `${provider}:${realModel}`;
  const probed = probeCache.get(probeKey);
  if (probed && Date.now() - probed.fetchedAt < PROBE_TTL_MS && probed.maxOutputTokens) {
    return probed.maxOutputTokens;
  }

  const registryHit = lookupRegistry(realModel);
  return registryHit?.maxOutput;
}

/**
 * Resolve all context-related metadata for a model in one call.
 */
export interface ContextLimitInfo {
  contextLength: number;
  maxOutputTokens?: number;
  /** 90% of context — the point where auto-compact / context truncation should kick in */
  autoCompactLimit: number;
  source: "db" | "yaml" | "probe" | "registry" | "default";
}

export function resolveContextLimitInfo(
  realModel: string,
  provider: string,
  dbOverride?: number | null,
  yamlOverride?: number,
  yamlMaxOutput?: number
): ContextLimitInfo {
  let contextLength: number;
  let source: ContextLimitInfo["source"];

  if (dbOverride && dbOverride > 0) {
    contextLength = dbOverride;
    source = "db";
  } else if (yamlOverride && yamlOverride > 0) {
    contextLength = yamlOverride;
    source = "yaml";
  } else {
    const probeKey = `${provider}:${realModel}`;
    const probed = probeCache.get(probeKey);
    if (probed && Date.now() - probed.fetchedAt < PROBE_TTL_MS) {
      contextLength = probed.contextLength;
      source = "probe";
    } else {
      const registryHit = lookupRegistry(realModel);
      if (registryHit) {
        contextLength = registryHit.context;
        source = "registry";
      } else {
        contextLength = DEFAULT_CONTEXT;
        source = "default";
      }
    }
  }

  const maxOutputTokens = resolveMaxOutputTokens(realModel, provider, yamlMaxOutput);
  const autoCompactLimit = Math.floor(contextLength * 0.9);

  return { contextLength, maxOutputTokens, autoCompactLimit, source };
}

// ── Auto-Probe: fetch upstream /models to discover real context_length ──

/**
 * Probe a provider's /models endpoint to discover context_length.
 * Currently supports OpenRouter (which returns context_length) and
 * caches the result. Other providers (Z.AI) don't expose it, so the
 * registry is used as fallback.
 *
 * Call this periodically (e.g. on server startup, or via a timer).
 * Non-blocking — failures are logged and silently ignored.
 */
export async function probeProviderModels(
  provider: string,
  providerType: string,
  baseUrl: string,
  apiKey: string | undefined
): Promise<void> {
  // Only OpenRouter exposes context_length in /models reliably
  if (providerType !== "openrouter") return;

  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(url, { headers });
    if (!res.ok) return;

    const json = await res.json() as { data?: Array<{ id?: string; context_length?: number; top_provider?: { max_completion_tokens?: number } }> };
    if (!json.data) return;

    const now = Date.now();
    for (const model of json.data) {
      if (!model.id || !model.context_length) continue;
      probeCache.set(`${provider}:${model.id}`, {
        contextLength: model.context_length,
        maxOutputTokens: model.top_provider?.max_completion_tokens,
        fetchedAt: now
      });
    }
  } catch {
    // Silent — probe is best-effort
  }
}

/**
 * Run probes for all configured providers. Idempotent — safe to call
 * repeatedly. Only fetches if cache entries are stale.
 */
export async function refreshProbeCache(
  configs: Array<{ name: string; type: string; baseUrl?: string; apiKey?: string }>
): Promise<void> {
  if (probeInProgress) return probeInProgress;

  probeInProgress = (async () => {
    await Promise.allSettled(
      configs.map((c) =>
        probeProviderModels(c.name, c.type, c.baseUrl ?? "https://openrouter.ai/api/v1", c.apiKey)
      )
    );
    probeInProgress = null;
  })();

  return probeInProgress;
}

/**
 * Get the probe cache state (for debugging / dashboard display).
 */
export function getProbeCacheState(): Array<{ key: string; contextLength: number; maxOutputTokens?: number; ageMinutes: number }> {
  const now = Date.now();
  return Array.from(probeCache.entries()).map(([key, val]) => ({
    key,
    contextLength: val.contextLength,
    maxOutputTokens: val.maxOutputTokens,
    ageMinutes: Math.floor((now - val.fetchedAt) / 60_000)
  }));
}
