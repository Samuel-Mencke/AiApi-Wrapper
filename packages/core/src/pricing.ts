const USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "qwen/qwen3-coder": { input: 0.2, output: 0.8 }
};

export function estimateCostUsd(model: string, inputTokens?: number, outputTokens?: number): number | null {
  const pricing = USD_PER_MILLION_TOKENS[model];
  if (!pricing) {
    return null;
  }

  const inputCost = ((inputTokens ?? 0) / 1_000_000) * pricing.input;
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * pricing.output;
  return Number((inputCost + outputCost).toFixed(8));
}
