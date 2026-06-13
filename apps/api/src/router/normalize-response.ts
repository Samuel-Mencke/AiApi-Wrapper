import type { InternalChatRequest, ProviderResponse } from "@ai-gateway/core";

/** Strip provider-specific fields from a raw response to make it OpenAI-compatible. */
function stripProviderFields(raw: Record<string, unknown>, includeReasoning: boolean): Record<string, unknown> {
  // Strip reasoning fields from choices
  const choices = raw.choices;
  if (Array.isArray(choices)) {
    raw.choices = choices.map((choice: any) => {
      const message = choice.message ?? choice.delta;
      if (!includeReasoning && message && typeof message === "object") {
        delete (message as any).reasoning_content;
        delete (message as any).thinking_content;
      }
      // Clean up empty strings in delta/message
      if (message && typeof message === "object") {
        for (const key of Object.keys(message)) {
          if (typeof (message as any)[key] === "string" && (message as any)[key] === "") {
            delete (message as any)[key];
          }
        }
      }
      return choice;
    });
  }

  // Remove provider-specific fields from root
  delete raw.request_id;

  // Ensure required OpenAI fields
  raw.object = raw.object ?? "chat.completion";

  return raw;
}

export function toOpenAiChatResponse(request: InternalChatRequest, response: ProviderResponse): unknown {
  if (response.raw && typeof response.raw === "object" && !Array.isArray(response.raw)) {
    const cleaned = stripProviderFields({ ...(response.raw as Record<string, unknown>) }, request.gateway?.includeReasoning === true);
    return {
      ...cleaned,
      model: request.modelAlias,
    };
  }

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: request.modelAlias,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: response.content,
          ...(response.toolCalls ? { tool_calls: response.toolCalls } : {}),
          ...(request.gateway?.includeReasoning && response.reasoningText ? { reasoning_content: response.reasoningText } : {}),
          ...(request.gateway?.includeReasoning && response.thinkingText ? { thinking_content: response.thinkingText } : {})
        },
        finish_reason: response.finishReason ?? (response.toolCalls ? "tool_calls" : "stop")
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
