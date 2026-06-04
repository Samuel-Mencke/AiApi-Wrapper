import type { InternalChatRequest, ProviderResponse } from "@ai-gateway/core";

export function toOpenAiChatResponse(request: InternalChatRequest, response: ProviderResponse): unknown {
  if (response.raw && typeof response.raw === "object" && !Array.isArray(response.raw)) {
    return {
      ...(response.raw as Record<string, unknown>),
      model: request.modelAlias,
      gateway: {
        provider: response.provider,
        real_model: response.model
      }
    };
  }

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.modelAlias,
    provider: response.provider,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: response.content
        },
        finish_reason: "stop"
      }
    ],
    usage: response.usage
      ? {
          prompt_tokens: response.usage.inputTokens ?? 0,
          completion_tokens: response.usage.outputTokens ?? 0,
          total_tokens: response.usage.totalTokens ?? 0
        }
      : undefined
  };
}
