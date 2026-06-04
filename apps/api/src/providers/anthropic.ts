import { GatewayError } from "@ai-gateway/core/errors";
import type { ProviderAdapter } from "./types.js";

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",
  supportsStreaming: false,
  async complete() {
    // TODO: Implement native Anthropic messages conversion and response normalization.
    throw new GatewayError("Anthropic native adapter is scaffolded but not implemented in this MVP", {
      code: "provider_not_implemented",
      statusCode: 501,
      retryable: false
    });
  },
  async test() {
    return {
      ok: false,
      message: "Anthropic native adapter is scaffolded; configure an OpenAI-compatible proxy for now"
    };
  }
};
