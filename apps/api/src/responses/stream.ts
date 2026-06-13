import { nanoid } from "nanoid";
import { buildResponseObject, type ResponseUsage } from "./compat.js";

interface ResponsesStreamOptions {
  responseId: string;
  createdAt: number;
  model: string;
  request: Record<string, unknown>;
  onComplete: (response: Record<string, unknown>, usage: ResponseUsage | null) => void;
}

interface ToolState {
  index: number;
  outputIndex: number;
  item: Record<string, unknown>;
  argumentsText: string;
}

export function createResponsesSseStream(
  providerStream: ReadableStream<Uint8Array>,
  options: ResponsesStreamOptions,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let sequence = 0;
  let finalized = false;
  let messageItem: Record<string, unknown> | null = null;
  let messageOutputIndex = -1;
  let messageText = "";
  let pendingUsage: ResponseUsage | null = null;
  const outputItems: Record<string, unknown>[] = [];
  const toolStates = new Map<number, ToolState>();

  function emit(
    controller: TransformStreamDefaultController<Uint8Array>,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    sequence += 1;
    const data = {
      type,
      ...payload,
      sequence_number: sequence
    };
    controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
  }

  function response(status: "in_progress" | "completed" | "failed" | "cancelled", usage: ResponseUsage | null): Record<string, unknown> {
    return buildResponseObject({
      id: options.responseId,
      createdAt: options.createdAt,
      completedAt: status === "completed" ? Math.floor(Date.now() / 1000) : null,
      status,
      model: options.model,
      request: options.request,
      output: status === "completed" ? outputItems : [],
      usage
    });
  }

  function ensureMessage(controller: TransformStreamDefaultController<Uint8Array>): void {
    if (messageItem) {
      return;
    }

    messageOutputIndex = outputItems.length;
    messageItem = {
      id: `msg_${nanoid(24)}`,
      type: "message",
      status: "in_progress",
      role: "assistant",
      content: []
    };
    outputItems.push(messageItem);
    emit(controller, "response.output_item.added", {
      output_index: messageOutputIndex,
      item: messageItem
    });
    emit(controller, "response.content_part.added", {
      item_id: messageItem.id,
      output_index: messageOutputIndex,
      content_index: 0,
      part: {
        type: "output_text",
        text: "",
        annotations: []
      }
    });
  }

  function ensureToolState(index: number, delta: Record<string, unknown>, controller: TransformStreamDefaultController<Uint8Array>): ToolState {
    const existing = toolStates.get(index);
    const fn = delta.function && typeof delta.function === "object" ? delta.function as Record<string, unknown> : {};
    if (existing) {
      if (typeof delta.id === "string") {
        existing.item.call_id = delta.id;
      }
      if (typeof fn.name === "string") {
        existing.item.name = `${existing.item.name ?? ""}${fn.name}`;
      }
      return existing;
    }

    const callId = typeof delta.id === "string" && delta.id.length > 0 ? delta.id : `call_${nanoid(24)}`;
    const state: ToolState = {
      index,
      outputIndex: outputItems.length,
      argumentsText: "",
      item: {
        type: "function_call",
        id: `fc_${nanoid(24)}`,
        call_id: callId,
        name: typeof fn.name === "string" ? fn.name : "",
        arguments: "",
        status: "in_progress"
      }
    };
    toolStates.set(index, state);
    outputItems.push(state.item);
    emit(controller, "response.output_item.added", {
      output_index: state.outputIndex,
      item: state.item
    });
    return state;
  }

  function captureUsage(parsed: Record<string, unknown>): void {
    const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage as Record<string, unknown> : null;
    if (!usage) {
      return;
    }

    const inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
    const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
    const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
    pendingUsage = {
      input_tokens: inputTokens ?? pendingUsage?.input_tokens,
      output_tokens: outputTokens ?? pendingUsage?.output_tokens,
      total_tokens: totalTokens ?? pendingUsage?.total_tokens
    };
  }

  function processChunk(parsed: Record<string, unknown>, controller: TransformStreamDefaultController<Uint8Array>): void {
    captureUsage(parsed);
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];

    for (const rawChoice of choices) {
      if (!rawChoice || typeof rawChoice !== "object") {
        continue;
      }

      const choice = rawChoice as Record<string, unknown>;
      captureUsage(choice);
      const delta = choice.delta && typeof choice.delta === "object" ? choice.delta as Record<string, unknown> : {};

      if (typeof delta.content === "string" && delta.content.length > 0) {
        ensureMessage(controller);
        messageText += delta.content;
        emit(controller, "response.output_text.delta", {
          item_id: messageItem?.id,
          output_index: messageOutputIndex,
          content_index: 0,
          delta: delta.content
        });
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const rawToolCall of delta.tool_calls) {
          if (!rawToolCall || typeof rawToolCall !== "object") {
            continue;
          }
          const toolCall = rawToolCall as Record<string, unknown>;
          const index = typeof toolCall.index === "number" ? toolCall.index : toolStates.size;
          const state = ensureToolState(index, toolCall, controller);
          const fn = toolCall.function && typeof toolCall.function === "object" ? toolCall.function as Record<string, unknown> : {};
          if (typeof fn.arguments === "string" && fn.arguments.length > 0) {
            state.argumentsText += fn.arguments;
            state.item.arguments = state.argumentsText;
            emit(controller, "response.function_call_arguments.delta", {
              item_id: state.item.id,
              output_index: state.outputIndex,
              delta: fn.arguments
            });
          }
        }
      }
    }
  }

  function finalize(controller: TransformStreamDefaultController<Uint8Array>): void {
    if (finalized) {
      return;
    }
    finalized = true;

    if (messageItem) {
      messageItem.status = "completed";
      messageItem.content = [
        {
          type: "output_text",
          text: messageText,
          annotations: []
        }
      ];
      emit(controller, "response.output_text.done", {
        item_id: messageItem.id,
        output_index: messageOutputIndex,
        content_index: 0,
        text: messageText
      });
      emit(controller, "response.content_part.done", {
        item_id: messageItem.id,
        output_index: messageOutputIndex,
        content_index: 0,
        part: {
          type: "output_text",
          text: messageText,
          annotations: []
        }
      });
      emit(controller, "response.output_item.done", {
        output_index: messageOutputIndex,
        item: messageItem
      });
    }

    for (const state of [...toolStates.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      state.item.status = "completed";
      state.item.arguments = state.argumentsText;
      emit(controller, "response.function_call_arguments.done", {
        item_id: state.item.id,
        output_index: state.outputIndex,
        arguments: state.argumentsText
      });
      emit(controller, "response.output_item.done", {
        output_index: state.outputIndex,
        item: state.item
      });
    }

    const finalResponse = response("completed", pendingUsage);
    options.onComplete(finalResponse, pendingUsage);
    emit(controller, "response.completed", {
      response: finalResponse
    });
  }

  return providerStream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      emit(controller, "response.created", {
        response: response("in_progress", null)
      });
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          finalize(controller);
          continue;
        }
        try {
          processChunk(JSON.parse(payload) as Record<string, unknown>, controller);
        } catch {
          // Drop malformed provider chunks. The final response remains well-formed.
        }
      }
    },
    flush(controller) {
      if (buffer.startsWith("data: ")) {
        const payload = buffer.slice(6).trim();
        if (payload && payload !== "[DONE]") {
          try {
            processChunk(JSON.parse(payload) as Record<string, unknown>, controller);
          } catch {
            // ignore final malformed provider fragment
          }
        }
      }
      finalize(controller);
    }
  }));
}
