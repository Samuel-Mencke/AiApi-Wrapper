export interface TokenPriceTier {
  input: number;
  output: number;
  /** Tier applies when the request input exceeds this many tokens. */
  aboveInputTokens?: number;
}

export interface ModelPricing {
  model: string;
  provider: "Z.AI" | "Google" | "OpenAI" | "OpenRouter";
  input: number;
  output: number;
  tiers?: readonly TokenPriceTier[];
  aliases?: readonly string[];
  note?: string;
}

/**
 * Public API-equivalent USD prices per million text tokens.
 * These are estimates; subscription, coding-plan and OAuth traffic may not be billed per token.
 */
export const MODEL_PRICING: readonly ModelPricing[] = [
  { model: "glm-5.2", provider: "Z.AI", input: 1.4, output: 4.4, aliases: ["glm5.2"] },
  { model: "glm-5.1", provider: "Z.AI", input: 1.4, output: 4.4, aliases: ["glm5.1"] },
  { model: "glm-5", provider: "Z.AI", input: 1, output: 3.2 },
  { model: "glm-5-turbo", provider: "Z.AI", input: 1.2, output: 4, aliases: ["glm5-turbo"] },
  { model: "glm-4.7", provider: "Z.AI", input: 0.6, output: 2.2 },
  { model: "glm-4.6", provider: "Z.AI", input: 0.6, output: 2.2 },
  { model: "glm-4.5", provider: "Z.AI", input: 0.6, output: 2.2 },

  { model: "gemini-3.5-flash", provider: "Google", input: 1.5, output: 9, aliases: ["gemini-flash", "gemini-flash-latest"] },
  { model: "gemini-3.5-flash-lite", provider: "Google", input: 0.3, output: 2.5, aliases: ["gemini-flash-lite", "gemini-flash-lite-latest"] },
  { model: "gemini-3.1-pro-preview", provider: "Google", input: 2, output: 12, aliases: ["gemini-3.1-pro", "gemini-pro", "gemini-pro-latest"], tiers: [{ input: 4, output: 18, aboveInputTokens: 200_000 }], note: ">200k input: $4 / $18" },
  { model: "gemini-3-pro-preview", provider: "Google", input: 2, output: 12, aliases: ["gemini-3-pro"], tiers: [{ input: 4, output: 18, aboveInputTokens: 200_000 }], note: "Legacy preview route; priced at current 3.1 Pro equivalent. >200k: $4 / $18" },
  { model: "gemini-3-flash-preview", provider: "Google", input: 0.5, output: 3, aliases: ["gemini-3-flash"] },
  { model: "gemini-2.5-pro", provider: "Google", input: 1.25, output: 10, tiers: [{ input: 2.5, output: 15, aboveInputTokens: 200_000 }], note: ">200k input: $2.50 / $15" },
  { model: "gemini-2.5-flash", provider: "Google", input: 0.3, output: 2.5 },
  { model: "gemini-2.5-flash-lite", provider: "Google", input: 0.1, output: 0.4 },
  { model: "gemini-2.0-flash", provider: "Google", input: 0.1, output: 0.4, note: "Deprecated; shut down June 1, 2026" },
  { model: "gemini-2.0-flash-lite", provider: "Google", input: 0.075, output: 0.3, note: "Deprecated; shut down June 1, 2026" },

  { model: "gpt-4o-mini", provider: "OpenAI", input: 0.15, output: 0.6 },
  { model: "gpt-4o", provider: "OpenAI", input: 2.5, output: 10 },
  { model: "gpt-5.5", provider: "OpenAI", input: 1.25, output: 10, aliases: ["gpt-5.5-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] },
  { model: "gpt-5.4", provider: "OpenAI", input: 0.5, output: 4, aliases: ["gpt-5.4-mini"] },
  { model: "qwen/qwen3-coder", provider: "OpenRouter", input: 0.2, output: 0.8 },
] as const;

const stripModeSuffix = (model: string) => model.trim().toLowerCase().replace(/-(?:u|c)$/, "");

const pricingByName = new Map<string, ModelPricing>();
for (const pricing of MODEL_PRICING) {
  pricingByName.set(pricing.model, pricing);
  for (const alias of pricing.aliases ?? []) pricingByName.set(alias, pricing);
}

/** Resolves gateway aliases and uncensored (-u/-c) variants to canonical pricing. */
export function getModelPricing(model: string): ModelPricing | null {
  return pricingByName.get(stripModeSuffix(model)) ?? null;
}

export function normalizePricingModel(model: string): string | null {
  return getModelPricing(model)?.model ?? null;
}

export function estimateCostUsd(model: string, inputTokens?: number, outputTokens?: number): number | null {
  const pricing = getModelPricing(model);
  if (!pricing) return null;

  const promptTokens = inputTokens ?? 0;
  const tier = [...(pricing.tiers ?? [])]
    .sort((a, b) => (b.aboveInputTokens ?? 0) - (a.aboveInputTokens ?? 0))
    .find((candidate) => promptTokens > (candidate.aboveInputTokens ?? Number.POSITIVE_INFINITY));
  const inputRate = tier?.input ?? pricing.input;
  const outputRate = tier?.output ?? pricing.output;
  const inputCost = (promptTokens / 1_000_000) * inputRate;
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * outputRate;
  return Number((inputCost + outputCost).toFixed(8));
}
