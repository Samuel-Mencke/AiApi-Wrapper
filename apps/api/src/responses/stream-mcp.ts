import { createResponsesSseStream as createBaseStream } from "./stream.js";
import type { ResponseUsage } from "./compat.js";
import { splitNamespacedToolName } from "./mcp-namespace.js";

interface StreamOptions {
  responseId: string;
  createdAt: number;
  model: string;
  request: Record<string, unknown>;
  onComplete: (response: Record<string, unknown>, usage: ResponseUsage | null) => void;
}

function mapItem(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  if (item.type !== "function_call" || typeof item.name !== "string") return;
  const identity = splitNamespacedToolName(item.name);
  item.name = identity.name;
  if (identity.namespace) item.namespace = identity.namespace;
  else delete item.namespace;
}

function mapResponse(response: Record<string, unknown>): void {
  const output = response.output;
  if (Array.isArray(output)) output.forEach(mapItem);
}

function mapPayload(payload: Record<string, unknown>): void {
  mapItem(payload.item);
  const response = payload.response;
  if (response && typeof response === "object") mapResponse(response as Record<string, unknown>);
}

function mapLine(line: string): string {
  if (!line.startsWith("data: ")) return line;
  const body = line.slice(6).trim();
  if (!body || body === "[DONE]") return line;
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    mapPayload(payload);
    return `data: ${JSON.stringify(payload)}`;
  } catch {
    return line;
  }
}

export function createResponsesSseStream(
  providerStream: ReadableStream<Uint8Array>,
  options: StreamOptions
): ReadableStream<Uint8Array> {
  const source = createBaseStream(providerStream, {
    ...options,
    onComplete(response, usage) {
      mapResponse(response);
      options.onComplete(response, usage);
    }
  });
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) controller.enqueue(encoder.encode(`${mapLine(line)}\n`));
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending) controller.enqueue(encoder.encode(mapLine(pending)));
    }
  }));
}
