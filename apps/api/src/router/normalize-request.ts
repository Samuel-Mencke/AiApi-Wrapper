import { z } from "zod";
import type { InternalChatRequest } from "@ai-gateway/core";

export const openAiChatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant", "tool"]),
      content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]),
      name: z.string().optional(),
      tool_call_id: z.string().optional()
    })
  ).min(1),
  temperature: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  stream_options: z.record(z.unknown()).optional(),
  tools: z.array(z.unknown()).optional(),
  extra_body: z.record(z.unknown()).optional()
});

export function normalizeRequest(input: unknown): InternalChatRequest {
  const parsed = openAiChatRequestSchema.parse(input);
  return {
    modelAlias: parsed.model,
    messages: parsed.messages.map((message) => ({
      role: message.role,
      content: message.content,
      name: message.name,
      toolCallId: message.tool_call_id
    })),
    temperature: parsed.temperature,
    maxTokens: parsed.max_tokens,
    stream: parsed.stream,
    streamOptions: parsed.stream_options,
    tools: parsed.tools,
    extraBody: parsed.extra_body
  };
}
