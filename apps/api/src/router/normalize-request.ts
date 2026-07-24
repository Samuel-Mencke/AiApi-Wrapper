import { z } from "zod";
import type { InternalChatRequest } from "@model-console/core";

export const openAiChatRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "developer", "user", "assistant", "tool"]),
      content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]),
      name: z.string().optional(),
      tool_call_id: z.string().optional(),
      tool_calls: z.array(z.unknown()).optional()
    })
  ).min(1),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  stream_options: z.record(z.unknown()).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  n: z.number().int().positive().optional(),
  seed: z.number().int().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  response_format: z.unknown().optional(),
  extra_body: z.record(z.unknown()).optional(),
  gateway: z.object({
    include_reasoning: z.boolean().optional()
  }).optional()
});

export function normalizeRequest(input: unknown): InternalChatRequest {
  const parsed = openAiChatRequestSchema.parse(input);
  const extraGateway = parsed.extra_body?.gateway;
  const includeReasoning = parsed.gateway?.include_reasoning === true
    || (typeof extraGateway === "object" && extraGateway !== null && (extraGateway as { include_reasoning?: unknown }).include_reasoning === true);
  return {
    modelAlias: parsed.model,
    messages: parsed.messages.map((message) => ({
      role: message.role === "developer" ? "system" : message.role,
      content: message.content,
      name: message.name,
      toolCallId: message.tool_call_id,
      toolCalls: message.tool_calls
    })),
    temperature: parsed.temperature,
    topP: parsed.top_p,
    maxTokens: parsed.max_tokens,
    maxCompletionTokens: parsed.max_completion_tokens,
    stream: parsed.stream,
    streamOptions: parsed.stream_options,
    stop: parsed.stop,
    n: parsed.n,
    seed: parsed.seed,
    tools: parsed.tools,
    toolChoice: parsed.tool_choice,
    parallelToolCalls: parsed.parallel_tool_calls,
    responseFormat: parsed.response_format,
    extraBody: parsed.extra_body,
    gateway: includeReasoning ? { includeReasoning: true } : undefined
  };
}
