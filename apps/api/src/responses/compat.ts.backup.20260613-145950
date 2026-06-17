import { nanoid } from "nanoid";
import type { InternalChatRequest, InternalMessage, ProviderResponse } from "@ai-gateway/core";

export interface ResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface ResponseBuildOptions {
  id: string;
  createdAt: number;
  completedAt?: number | null;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  model: string;
  request: Record<string, unknown>;
  output?: unknown[];
  usage?: ResponseUsage | null;
  error?: unknown;
}

export function inputItemsFromResponseInput(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input;
  }
  if (typeof input === "string") {
    return [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: input }]
      }
    ];
  }
  if (input && typeof input === "object") {
    return [input];
  }
  return [];
}

export function responseToolsToChatTools(tools: unknown[] | undefined): unknown[] | undefined {
  if (!tools) {
    return undefined;
  }

  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") {
      return tool;
    }

    const value = tool as Record<string, unknown>;
    if (value.type === "function" && value.function) {
      return tool;
    }
    if (value.type !== "function") {
      return tool;
    }

    return {
      type: "function",
      function: {
        name: value.name,
        description: value.description,
        parameters: value.parameters,
        strict: value.strict
      }
    };
  });
}

export function responseToolChoiceToChatToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object") {
    return toolChoice;
  }

  const value = toolChoice as Record<string, unknown>;
  if (value.type !== "function" || !value.name) {
    return toolChoice;
  }

  return {
    type: "function",
    function: {
      name: value.name
    }
  };
}

export function responseInputItemsToMessages(items: unknown[], instructions?: string | null): InternalMessage[] {
  const messages: InternalMessage[] = [];

  if (instructions && instructions.trim().length > 0) {
    messages.push({ role: "system", content: instructions });
  }

  for (const item of items) {
    messages.push(...responseInputItemToMessages(item));
  }

  return messages;
}

export function responseOutputItemsToMessages(output: unknown[]): InternalMessage[] {
  const messages: InternalMessage[] = [];
  const toolCalls: unknown[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const value = item as Record<string, unknown>;
    if (value.type === "function_call") {
      toolCalls.push(responseFunctionCallToChatToolCall(value));
      continue;
    }

    if (value.type === "message") {
      messages.push({
        role: "assistant",
        content: contentToText(value.content)
      });
    }
  }

  if (toolCalls.length > 0) {
    messages.push({
      role: "assistant",
      content: null,
      toolCalls
    });
  }

  return messages;
}

export function buildInternalChatRequest(options: {
  responseRequest: Record<string, unknown>;
  messages: InternalMessage[];
  requestId?: string;
}): InternalChatRequest {
  const request = options.responseRequest;
  const text = request.text && typeof request.text === "object" ? request.text as Record<string, unknown> : undefined;
  const textFormat = text?.format && typeof text.format === "object" ? text.format : undefined;

  return {
    requestId: options.requestId,
    modelAlias: String(request.model),
    messages: options.messages,
    temperature: typeof request.temperature === "number" ? request.temperature : undefined,
    topP: typeof request.top_p === "number" ? request.top_p : undefined,
    maxTokens: typeof request.max_output_tokens === "number" ? request.max_output_tokens : undefined,
    stream: Boolean(request.stream),
    tools: responseToolsToChatTools(Array.isArray(request.tools) ? request.tools : undefined),
    toolChoice: responseToolChoiceToChatToolChoice(request.tool_choice),
    parallelToolCalls: typeof request.parallel_tool_calls === "boolean" ? request.parallel_tool_calls : undefined,
    responseFormat: textFormat,
    extraBody: responseExtraBody(request)
  };
}

export function buildResponseObject(options: ResponseBuildOptions): Record<string, unknown> {
  const request = options.request;
  const output = options.output ?? [];
  const completedAt = options.completedAt === undefined ? null : options.completedAt;
  return {
    id: options.id,
    object: "response",
    created_at: options.createdAt,
    status: options.status,
    completed_at: completedAt,
    error: options.error ?? null,
    incomplete_details: null,
    instructions: request.instructions ?? null,
    max_output_tokens: request.max_output_tokens ?? null,
    model: options.model,
    output,
    output_text: outputText(output),
    parallel_tool_calls: request.parallel_tool_calls ?? true,
    previous_response_id: request.previous_response_id ?? null,
    reasoning: request.reasoning ?? { effort: null, summary: null },
    store: request.store ?? true,
    temperature: request.temperature ?? null,
    text: request.text ?? { format: { type: "text" } },
    tool_choice: request.tool_choice ?? "auto",
    tools: request.tools ?? [],
    top_p: request.top_p ?? null,
    truncation: request.truncation ?? "disabled",
    usage: options.usage ?? null,
    user: request.user ?? null,
    metadata: request.metadata ?? {}
  };
}

export function responseOutputFromProvider(response: ProviderResponse): unknown[] {
  const output: unknown[] = [];
  const text = responseContentToText(response.content);

  if (text.length > 0) {
    output.push({
      id: `msg_${nanoid(24)}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text,
          annotations: []
        }
      ]
    });
  }

  if (Array.isArray(response.toolCalls)) {
    for (const toolCall of response.toolCalls) {
      output.push(chatToolCallToResponseFunctionCall(toolCall));
    }
  }

  return output;
}

export function usageFromProvider(response: ProviderResponse): ResponseUsage | null {
  if (!response.usage) {
    return null;
  }

  const inputTokens = response.usage.inputTokens ?? 0;
  const outputTokens = response.usage.outputTokens ?? 0;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: response.usage.totalTokens ?? inputTokens + outputTokens
  };
}

export function responseContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  if (Array.isArray(content)) {
    return content.map(responseContentToText).join("");
  }
  if (typeof content === "object") {
    const value = content as Record<string, unknown>;
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
  }
  return String(content);
}

export function chatToolCallToResponseFunctionCall(toolCall: unknown): Record<string, unknown> {
  const value = toolCall && typeof toolCall === "object" ? toolCall as Record<string, unknown> : {};
  const fn = value.function && typeof value.function === "object" ? value.function as Record<string, unknown> : {};
  const callId = typeof value.id === "string" && value.id.length > 0 ? value.id : `call_${nanoid(24)}`;
  const name = typeof fn.name === "string" ? fn.name : typeof value.name === "string" ? value.name : "";
  const rawArguments = fn.arguments ?? value.arguments ?? "";
  const args = typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments);

  return {
    type: "function_call",
    id: `fc_${nanoid(24)}`,
    call_id: callId,
    name,
    arguments: args,
    status: "completed"
  };
}

function responseInputItemToMessages(item: unknown): InternalMessage[] {
  if (!item || typeof item !== "object") {
    return [{ role: "user", content: responseContentToText(item) }];
  }

  const value = item as Record<string, unknown>;
  if (value.type === "function_call_output") {
    return [
      {
        role: "tool",
        toolCallId: typeof value.call_id === "string" ? value.call_id : undefined,
        content: responseContentToText(value.output)
      }
    ];
  }

  if (value.type === "function_call") {
    return [
      {
        role: "assistant",
        content: null,
        toolCalls: [responseFunctionCallToChatToolCall(value)]
      }
    ];
  }

  if (value.type === "input_text") {
    return [{ role: "user", content: responseContentToText(value.text) }];
  }

  const role = normalizeRole(value.role);
  if (role) {
    return [
      {
        role,
        content: contentToText(value.content),
        name: typeof value.name === "string" ? value.name : undefined,
        toolCallId: typeof value.tool_call_id === "string" ? value.tool_call_id : undefined,
        toolCalls: Array.isArray(value.tool_calls) ? value.tool_calls : undefined
      }
    ];
  }

  return [{ role: "user", content: JSON.stringify(value) }];
}

function normalizeRole(role: unknown): InternalMessage["role"] | null {
  if (role === "developer" || role === "system") {
    return "system";
  }
  if (role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return null;
}

function contentToText(content: unknown): InternalMessage["content"] {
  if (content === undefined) {
    return "";
  }
  if (typeof content === "string" || content === null) {
    return content;
  }
  if (Array.isArray(content)) {
    const mapped = content.map((part) => {
      if (!part || typeof part !== "object") {
        return { type: "text", text: responseContentToText(part) };
      }
      const value = part as Record<string, unknown>;
      if (value.type === "input_text" || value.type === "output_text") {
        return { type: "text", text: responseContentToText(value.text) };
      }
      return value;
    }) as Array<Record<string, unknown>>;

    if (mapped.every((part) => part.type === "text" && typeof part.text === "string")) {
      return mapped.map((part) => part.text as string).join("");
    }
    return mapped;
  }
  return responseContentToText(content);
}

function responseFunctionCallToChatToolCall(item: Record<string, unknown>): Record<string, unknown> {
  const callId = typeof item.call_id === "string" ? item.call_id : `call_${nanoid(24)}`;
  const name = typeof item.name === "string" ? item.name : "";
  const rawArguments = item.arguments ?? "";
  return {
    id: callId,
    type: "function",
    function: {
      name,
      arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments)
    }
  };
}

function outputText(output: unknown[]): string {
  return output.map((item) => {
    if (!item || typeof item !== "object") {
      return "";
    }
    const value = item as Record<string, unknown>;
    if (value.type !== "message") {
      return "";
    }
    return responseContentToText(value.content);
  }).join("");
}

function responseExtraBody(request: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const key of ["reasoning", "max_tool_calls", "service_tier", "truncation"]) {
    if (request[key] !== undefined) {
      extra[key] = request[key];
    }
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}
