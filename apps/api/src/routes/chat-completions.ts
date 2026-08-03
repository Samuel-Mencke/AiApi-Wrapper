import type { FastifyInstance } from "fastify";
import { estimateCostUsd } from "@model-console/core/pricing";
import { requireApiAuth } from "../middleware/auth.js";
import { logRequest } from "../middleware/request-logger.js";
import { applyUncensoredTransform, buildRetryMessages, detectRefusal, isUncensoredAlias } from "../middleware/uncensored.js";
import { executeStreamWithFallback, executeWithFallback } from "../router/fallback.js";
import { normalizeRequest } from "../router/normalize-request.js";
import { addRequestAbortSignal } from "../router/request-control.js";
import { toOpenAiChatResponse } from "../router/normalize-response.js";

/**
 * Sanitize a parsed SSE chunk for strict OpenAI compatibility.
 * - Strips reasoning fields from delta
 * - Strips empty string values from delta
 * - Strips provider-specific fields (request_id, gateway)
 * - Extracts usage from inside choices to top-level
 * - Returns null if chunk contains nothing meaningful
 */
function sanitizeSSEChunk(parsed: any, includeReasoning: boolean): any | null {
  // Strip non-standard fields from root
  delete parsed.request_id;
  delete parsed.gateway;

  // Ensure required fields
  parsed.object = "chat.completion.chunk";

  const choices = parsed.choices;

  if (!choices || !Array.isArray(choices) || choices.length === 0) {
    // Usage-only chunk (no choices) — keep for later handling
    return parsed.usage ? parsed : null;
  }

  const sanitizedChoices: any[] = [];
  for (const choice of choices) {
    const delta = { ...(choice.delta ?? {}) };

    if (!includeReasoning) {
      // Strip reasoning fields (Z.ai sends reasoning_content alongside content)
      delete delta.reasoning_content;
      delete delta.thinking_content;
    }

    // Extract usage from inside the choice — providers like Z.AI put it there
    if (choice.usage && typeof choice.usage === "object") {
      // Promote to top-level (last one wins if multiple choices have it)
      parsed.usage = { ...choice.usage, ...parsed.usage };
      delete choice.usage;
    }

    // Strip empty string values — OpenAI never sends empty content ""
    for (const key of Object.keys(delta)) {
      if (typeof delta[key] === "string" && delta[key] === "") {
        delete delta[key];
      }
    }

    const hasContent = typeof delta.content === "string" && delta.content.length > 0;
    const hasReasoning = includeReasoning && (
      typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0
      || typeof delta.thinking_content === "string" && delta.thinking_content.length > 0
    );
    const hasToolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
    const hasFunctionCall = Boolean(delta.function_call);
    const hasFinishReason = Boolean(choice.finish_reason);

    // For finish_reason-only chunks (no content/tool_calls), strip role — OpenAI sends delta: {}
    if (hasFinishReason && !hasContent && !hasReasoning && !hasToolCalls && !hasFunctionCall) {
      delete delta.role;
    }

    if (hasContent || hasReasoning || hasToolCalls || hasFunctionCall || hasFinishReason) {
      sanitizedChoices.push({ ...choice, delta });
    }
  }

  if (sanitizedChoices.length === 0 && !parsed.usage) {
    return null;
  }

  return { ...parsed, choices: sanitizedChoices };
}

/**
 * TransformStream that sanitizes SSE chunks for strict OpenAI compatibility.
 * - Line-buffered to handle TCP chunk splitting correctly
 * - SSE spec compliant: events separated by \n\n
 * - Strips all provider-specific fields
 * - Drops reasoning-only chunks silently
 * - Promotes usage from inside choices to top-level
 * - Only emits usage if includeUsage is true, as a separate chunk before [DONE]
 */
function createOpenAICompatibleFilter(
  includeUsage: boolean,
  includeReasoning: boolean,
  modelAlias: string,
  onUsage?: (usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }) => void
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";
  let pendingUsage: any = null;
  let usageReported = false;
  let chunkId: string | undefined;
  let chunkCreated: number | undefined;
  let chunkModel: string | undefined;

  function emitUsage(controller: TransformStreamDefaultController<any>) {
    // Report usage to the callback regardless of includeUsage flag,
    // so the gateway can log real token counts even when the client
    // didn't ask for usage in the SSE stream.
    if (pendingUsage && onUsage && !usageReported) {
      onUsage({
        prompt_tokens: pendingUsage.prompt_tokens,
        completion_tokens: pendingUsage.completion_tokens,
        total_tokens: pendingUsage.total_tokens
      });
      usageReported = true;
    }
    if (!pendingUsage || !includeUsage) {
      pendingUsage = null;
      return;
    }
    const usageChunk: any = {
      id: chunkId ?? `gw-${Date.now()}`,
      object: "chat.completion.chunk",
      created: chunkCreated ?? Math.floor(Date.now() / 1000),
      model: chunkModel,
      choices: [],
      usage: pendingUsage
    };
    // Only keep standard OpenAI usage fields
    const cleanUsage: any = {};
    if (pendingUsage.prompt_tokens !== undefined) cleanUsage.prompt_tokens = pendingUsage.prompt_tokens;
    if (pendingUsage.completion_tokens !== undefined) cleanUsage.completion_tokens = pendingUsage.completion_tokens;
    if (pendingUsage.total_tokens !== undefined) cleanUsage.total_tokens = pendingUsage.total_tokens;
    // Keep _details fields if present
    if (pendingUsage.prompt_tokens_details) cleanUsage.prompt_tokens_details = pendingUsage.prompt_tokens_details;
    if (pendingUsage.completion_tokens_details) cleanUsage.completion_tokens_details = pendingUsage.completion_tokens_details;
    usageChunk.usage = cleanUsage;

    controller.enqueue(encoder.encode(`data: ${JSON.stringify(usageChunk)}\n\n`));
    pendingUsage = null;
  }

  function processLine(line: string, controller: TransformStreamDefaultController<any>) {
    if (!line.startsWith("data: ")) {
      return;
    }

    const payload = line.slice(6).trim();
    if (payload === "[DONE]") {
      // Emit pending usage chunk before [DONE]
      emitUsage(controller);
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // Incomplete/broken JSON from TCP split — drop silently
      return;
    }

    const sanitized = sanitizeSSEChunk(parsed, includeReasoning);
    if (!sanitized) {
      return;
    }

    // Capture metadata for the usage chunk
    if (sanitized.id) chunkId = sanitized.id;
    if (sanitized.created) chunkCreated = sanitized.created;
    sanitized.model = modelAlias;
    chunkModel = modelAlias;

    // Extract usage from the sanitized chunk
    if (sanitized.usage) {
      pendingUsage = { ...pendingUsage, ...sanitized.usage };
      delete sanitized.usage;
    }

    // If chunk now has neither choices nor usage, drop it
    if (!sanitized.choices || sanitized.choices.length === 0) {
      return;
    }

    // Remove usage from inside any choice (sanitization should have done this, but be safe)
    for (const choice of sanitized.choices) {
      delete choice.usage;
    }

    controller.enqueue(encoder.encode(`data: ${JSON.stringify(sanitized)}\n\n`));
  }

  return new TransformStream({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });

      const lines = lineBuffer.split("\n");
      // Keep last element — it may be an incomplete line (no trailing \n yet)
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line, controller);
      }
    },

    flush(controller) {
      // Process any remaining data in the buffer on stream end
      if (lineBuffer.length > 0) {
        processLine(lineBuffer, controller);
        lineBuffer = "";
      }
      // If stream ended without [DONE], still emit pending usage
      emitUsage(controller);
    }
  });
}

export async function chatCompletionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/chat/completions", { preHandler: requireApiAuth }, async (request, reply) => {
    const internal = normalizeRequest(request.body);
    internal.requestId = request.requestId;
    const clientAbort = new AbortController();
    const abortClient = () => {
      if (!clientAbort.signal.aborted) {
        clientAbort.abort(new DOMException("Client disconnected", "AbortError"));
      }
    };
    request.raw.once("aborted", abortClient);
    reply.raw.once("close", abortClient);
    const removeClientSignal = addRequestAbortSignal(internal, clientAbort.signal);
    const cleanupClientSignal = () => {
      removeClientSignal();
      request.raw.off("aborted", abortClient);
      reply.raw.off("close", abortClient);
    };

    // Uncensored mode: strip all system prompts, inject uncensored prompt
    const uncensoredStreamMode = isUncensoredAlias(internal.modelAlias);
    if (uncensoredStreamMode) {
      internal.messages = applyUncensoredTransform(internal.messages);
    }

    if (internal.stream) {
      try {
      // For uncensored streaming, use buffer-and-check: accumulate the first
      // ~500 chars, check for refusal, and if detected, retry with prefill.
      // If no refusal, flush buffer + stream the rest normally.
      const MAX_STREAM_RETRIES = 2;
      let currentMessages = internal.messages;

      if (uncensoredStreamMode) {
        for (let retry = 0; retry <= MAX_STREAM_RETRIES; retry++) {
          const { stream: rawStream, logContext: lc } = await executeStreamWithFallback({ ...internal, messages: currentMessages }, request.auth.apiKeyId);

          const includeUsage = Boolean(
            internal.streamOptions &&
            typeof internal.streamOptions === "object" &&
            (internal.streamOptions as any).include_usage === true
          );
          const includeReasoning = internal.gateway?.includeReasoning === true;

          const usageRef: { value: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null } = {
            value: null
          };

          // Buffer first ~500 chars of content, then check for refusal
          const buffer: string[] = [];
          let totalContent = "";
          let bufferComplete = false;
          let refusalInBuffer = false;

          // We need to read the raw stream, check for refusal, then either
          // retry or hand off to the client
          const reader = rawStream.getReader();
          const decoder = new TextDecoder();
          let streamBuffer = "";
          let accumulatedContent = "";

          // Read until we have enough content or stream ends
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamBuffer += decoder.decode(value, { stream: true });

            // Parse SSE chunks to extract content
            const events = streamBuffer.split("\n\n");
            streamBuffer = events.pop() ?? "";
            for (const event of events) {
              const dataLines = event.split("\n").filter(l => l.startsWith("data: ")).map(l => l.slice(6).trim());
              for (const payload of dataLines) {
                if (payload === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(payload);
                  const choice = parsed.choices?.[0];
                  const content = choice?.delta?.content;
                  if (typeof content === "string") {
                    accumulatedContent += content;
                  }
                } catch {}
              }
            }

            // Check if we have enough to detect refusal
            if (accumulatedContent.length >= 500) {
              if (detectRefusal(accumulatedContent)) {
                refusalInBuffer = true;
              }
              bufferComplete = true;
              break;
            }
          }

          // Also check at end of stream if buffer wasn't completed
          if (!bufferComplete && accumulatedContent.length > 20) {
            if (detectRefusal(accumulatedContent)) {
              refusalInBuffer = true;
            }
          }

          reader.cancel().catch(() => {});

          if (!refusalInBuffer || retry >= MAX_STREAM_RETRIES) {
            // No refusal (or max retries hit) — stream the response to client
            // Since we already consumed the stream, we need to re-request
            // and stream it properly. We already know it won't refuse.
            const { stream: cleanStream, logContext } = await executeStreamWithFallback({ ...internal, messages: currentMessages }, request.auth.apiKeyId);

            const filteredStream = cleanStream.pipeThrough(createOpenAICompatibleFilter(
              includeUsage,
              includeReasoning,
              internal.modelAlias,
              (usage) => { usageRef.value = usage; }
            ));

            reply.hijack();
            reply.raw.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "x-request-id": request.requestId
            });

            const finalReader = filteredStream.getReader();
            try {
              while (true) {
                const { done, value } = await finalReader.read();
                if (done) break;
                reply.raw.write(value);
              }
              reply.raw.end();
            } catch {
              try { reply.raw.end(); } catch {}
            }

            const realUsage = usageRef.value;
            logRequest({
              requestId: logContext.requestId,
              apiKeyId: logContext.apiKeyId,
              modelAlias: logContext.modelAlias,
              provider: logContext.provider,
              realModel: logContext.realModel,
              status: "success",
              latencyMs: Date.now() - logContext.started,
              inputTokens: realUsage?.prompt_tokens,
              outputTokens: realUsage?.completion_tokens,
              estimatedCost: estimateCostUsd(logContext.realModel, realUsage?.prompt_tokens, realUsage?.completion_tokens)
            });

            return;
          }

          // Refusal detected — retry with prefill+nudge
          currentMessages = buildRetryMessages(currentMessages, accumulatedContent, "de");
          continue;
        }
      }

      // Normal (non-uncensored) streaming path
      const { stream, logContext } = await executeStreamWithFallback(internal, request.auth.apiKeyId);

      // Check if client requested usage in stream
      const includeUsage = Boolean(
        internal.streamOptions &&
        typeof internal.streamOptions === "object" &&
        (internal.streamOptions as any).include_usage === true
      );
      const includeReasoning = internal.gateway?.includeReasoning === true;

      // Track real usage from the stream's final chunk.
      // Use a wrapper object so TypeScript control-flow analysis doesn't narrow to `never`.
      const usageRef: { value: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null } = {
        value: null
      };

      const filteredStream = stream.pipeThrough(createOpenAICompatibleFilter(
        includeUsage,
        includeReasoning,
        internal.modelAlias,
        (usage) => { usageRef.value = usage; }
      ));

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-request-id": request.requestId
      });

      const reader = filteredStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          reply.raw.write(value);
        }
        reply.raw.end();
      } catch {
        try {
          reply.raw.end();
        } catch {
          // ignore
        }
      }

      // Log with REAL token counts now that the stream is complete
      const realUsage = usageRef.value;
      logRequest({
        requestId: logContext.requestId,
        apiKeyId: logContext.apiKeyId,
        modelAlias: logContext.modelAlias,
        provider: logContext.provider,
        realModel: logContext.realModel,
        status: "success",
        latencyMs: Date.now() - logContext.started,
        inputTokens: realUsage?.prompt_tokens,
        outputTokens: realUsage?.completion_tokens,
        estimatedCost: estimateCostUsd(logContext.realModel, realUsage?.prompt_tokens, realUsage?.completion_tokens)
      });

      return;
      } finally {
        cleanupClientSignal();
      }
    }

    try {
      // Uncensored non-streaming: detect refusal and auto-retry with prefill
      if (isUncensoredAlias(internal.modelAlias)) {
        const MAX_RETRIES = 2;
        for (let retry = 0; retry <= MAX_RETRIES; retry++) {
          const result = await executeWithFallback(internal, request.auth.apiKeyId);
          const responseText = typeof result.response.content === "string"
            ? result.response.content
            : (result.response.raw as any)?.choices?.[0]?.message?.content;
          if (typeof responseText !== "string" || !detectRefusal(responseText) || retry >= MAX_RETRIES) {
            return toOpenAiChatResponse(internal, result.response);
          }
          // Refusal detected — rebuild messages with nudge + prefill and retry
          internal.messages = buildRetryMessages(internal.messages, responseText, "de");
        }
      }
      const result = await executeWithFallback(internal, request.auth.apiKeyId);
      return toOpenAiChatResponse(internal, result.response);
    } finally {
      cleanupClientSignal();
    }
  });
}
