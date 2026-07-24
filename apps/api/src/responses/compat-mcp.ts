import { nanoid } from "nanoid";
import type { InternalChatRequest, InternalMessage, ProviderResponse } from "@model-console/core";
import * as legacy from "./compat.js";
import { flattenNamespacedToolName, splitNamespacedToolName } from "./mcp-namespace.js";

export type { ResponseBuildOptions, ResponseUsage } from "./compat.js";
export {
  buildResponseObject,
  inputItemsFromResponseInput,
  responseContentToText,
  usageFromProvider
} from "./compat.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function functionSource(tool: Record<string, unknown>): Record<string, unknown> {
  return record(tool.function) ?? tool;
}

function toChatFunction(
  source: Record<string, unknown>,
  namespace?: string,
  namespaceDescription?: string
): Record<string, unknown> | null {
  const name = typeof source.name === "string" ? source.name.trim() : "";
  if (!name) return null;

  const ownDescription = typeof source.description === "string" ? source.description.trim() : "";
  const description = [namespaceDescription?.trim(), ownDescription]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

  return {
    type: "function",
    function: {
      name: flattenNamespacedToolName(name, namespace),
      description,
      parameters: record(source.parameters) ?? { type: "object", properties: {} }
    }
  };
}

export function responseToolsToChatTools(tools: unknown[] | undefined): unknown[] | undefined {
  if (!tools) return undefined;
  const converted: unknown[] = [];

  for (const rawTool of tools) {
    const tool = record(rawTool);
    if (!tool) continue;

    if (tool.type === "function") {
      const convertedTool = toChatFunction(functionSource(tool));
      if (convertedTool) converted.push(convertedTool);
      continue;
    }

    if (tool.type !== "namespace") continue;
    const namespace = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!namespace) continue;
    const namespaceDescription = typeof tool.description === "string" ? tool.description : undefined;

    for (const rawNested of Array.isArray(tool.tools) ? tool.tools : []) {
      const nested = record(rawNested);
      if (!nested || nested.type !== "function") continue;
      const convertedTool = toChatFunction(functionSource(nested), namespace, namespaceDescription);
      if (convertedTool) converted.push(convertedTool);
    }
  }

  return converted.length > 0 ? converted : undefined;
}

export function responseToolChoiceToChatToolChoice(toolChoice: unknown): unknown {
  if (toolChoice === undefined || toolChoice === null) return undefined;
  if (toolChoice === "auto" || toolChoice === "none" || toolChoice === "required") return toolChoice;

  const choice = record(toolChoice);
  if (!choice || choice.type !== "function") return "auto";
  const source = functionSource(choice);
  if (typeof source.name !== "string" || !source.name.trim()) return "auto";
  const namespace = typeof source.namespace === "string"
    ? source.namespace
    : typeof choice.namespace === "string" ? choice.namespace : undefined;

  return {
    type: "function",
    function: { name: flattenNamespacedToolName(source.name, namespace) }
  };
}

function responseFunctionCallToChatToolCall(item: Record<string, unknown>): Record<string, unknown> {
  const rawArguments = item.arguments ?? "";
  return {
    id: typeof item.call_id === "string" ? item.call_id : `call_${nanoid(24)}`,
    type: "function",
    function: {
      name: flattenNamespacedToolName(
        typeof item.name === "string" ? item.name : "",
        typeof item.namespace === "string" ? item.namespace : undefined
      ),
      arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments)
    }
  };
}

export function responseInputItemsToMessages(items: unknown[], instructions?: string | null): InternalMessage[] {
  const messages: InternalMessage[] = [];
  if (instructions?.trim()) messages.push({ role: "system", content: instructions });

  for (const item of items) {
    const value = record(item);
    if (value?.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        toolCalls: [responseFunctionCallToChatToolCall(value)]
      });
    } else {
      messages.push(...legacy.responseInputItemsToMessages([item]));
    }
  }

  return messages;
}

export function responseOutputItemsToMessages(output: unknown[]): InternalMessage[] {
  const messages: InternalMessage[] = [];
  const toolCalls: unknown[] = [];

  for (const rawItem of output) {
    const item = record(rawItem);
    if (!item) continue;
    if (item.type === "function_call") {
      toolCalls.push(responseFunctionCallToChatToolCall(item));
    } else if (item.type === "message") {
      messages.push({ role: "assistant", content: legacy.responseContentToText(item.content) });
    }
  }

  if (toolCalls.length > 0) messages.push({ role: "assistant", content: null, toolCalls });
  return messages;
}

export function buildInternalChatRequest(options: {
  responseRequest: Record<string, unknown>;
  messages: InternalMessage[];
  requestId?: string;
}): InternalChatRequest {
  const request = options.responseRequest;
  const text = record(request.text);

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
    responseFormat: record(text?.format),
    extraBody: responseExtraBody(request)
  };
}

export function chatToolCallToResponseFunctionCall(toolCall: unknown): Record<string, unknown> {
  const value = record(toolCall) ?? {};
  const fn = record(value.function) ?? {};
  const flatName = typeof fn.name === "string" ? fn.name : typeof value.name === "string" ? value.name : "";
  const identity = splitNamespacedToolName(flatName);
  const rawArguments = fn.arguments ?? value.arguments ?? "";

  return {
    type: "function_call",
    id: `fc_${nanoid(24)}`,
    call_id: typeof value.id === "string" && value.id ? value.id : `call_${nanoid(24)}`,
    name: identity.name,
    ...(identity.namespace ? { namespace: identity.namespace } : {}),
    arguments: typeof rawArguments === "string" ? rawArguments : JSON.stringify(rawArguments),
    status: "completed"
  };
}

export function responseOutputFromProvider(response: ProviderResponse): unknown[] {
  const output: unknown[] = [];
  const text = legacy.responseContentToText(response.content);

  if (text) {
    output.push({
      id: `msg_${nanoid(24)}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }]
    });
  }

  if (Array.isArray(response.toolCalls)) {
    for (const toolCall of response.toolCalls) output.push(chatToolCallToResponseFunctionCall(toolCall));
  }
  return output;
}

function responseExtraBody(request: Record<string, unknown>): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  const reasoning = record(request.reasoning);
  const effort = typeof reasoning?.effort === "string" ? reasoning.effort : undefined;
  if (effort === "none") extra.thinking = { type: "disabled" };
  else if (effort) extra.thinking = { type: "enabled" };
  else if (request.thinking !== undefined) extra.thinking = request.thinking;
  return Object.keys(extra).length > 0 ? extra : undefined;
}
