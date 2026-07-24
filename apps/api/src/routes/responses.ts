import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import { GatewayError } from "@model-console/core/errors";
import { estimateCostUsd } from "@model-console/core/pricing";
import type { AuthContext } from "../middleware/auth.js";
import { requireApiAuth } from "../middleware/auth.js";
import { logRequest } from "../middleware/request-logger.js";
import { db } from "../db/client.js";
import { responseInputItems, storedResponses } from "../db/schema.js";
import { executeStreamWithFallback, executeWithFallback } from "../router/fallback.js";
import {
  buildInternalChatRequest,
  buildResponseObject,
  inputItemsFromResponseInput,
  responseInputItemsToMessages,
  responseOutputFromProvider,
  responseOutputItemsToMessages,
  usageFromProvider
} from "../responses/compat.js";
import { createResponsesSseStream } from "../responses/stream.js";
import { applyUncensoredTransform, isUncensoredAlias, uncensoredInstructions } from "../middleware/uncensored.js";

const responseCreateSchema = z.object({
  model: z.string().min(1),
  input: z.unknown(),
  instructions: z.string().nullable().optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  previous_response_id: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  store: z.boolean().optional(),
  text: z.record(z.unknown()).optional(),
  reasoning: z.unknown().optional(),
  truncation: z.unknown().optional(),
  max_tool_calls: z.number().int().positive().optional(),
  service_tier: z.unknown().optional(),
  user: z.string().optional()
}).passthrough();

type StoredResponseRow = typeof storedResponses.$inferSelect;

function requestRecord(parsed: z.infer<typeof responseCreateSchema>): Record<string, unknown> {
  return parsed as Record<string, unknown>;
}

function canAccessResponse(row: StoredResponseRow, auth: AuthContext): boolean {
  return auth.isAdmin || row.apiKeyId === auth.apiKeyId;
}

function notFound(id: string): GatewayError {
  return new GatewayError(`Response '${id}' does not exist.`, {
    code: "response_not_found",
    statusCode: 404,
    param: "response_id"
  });
}

function getStoredResponse(id: string, auth: AuthContext): StoredResponseRow {
  const row = db.select().from(storedResponses).where(eq(storedResponses.id, id)).get();
  if (!row || row.deletedAt || !canAccessResponse(row, auth)) {
    throw notFound(id);
  }
  return row;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function collectPreviousMessages(responseId: string | null | undefined, auth: AuthContext, depth = 0): ReturnType<typeof responseInputItemsToMessages> {
  if (!responseId) {
    return [];
  }
  if (depth > 20) {
    throw new GatewayError("Response conversation chain is too deep.", {
      code: "context_length_exceeded",
      statusCode: 400,
      param: "previous_response_id"
    });
  }

  const row = getStoredResponse(responseId, auth);
  const requestJson = parseJson<Record<string, unknown>>(row.requestJson, {});
  const responseJson = parseJson<Record<string, unknown>>(row.responseJson, {});
  const previous = typeof requestJson.previous_response_id === "string" ? requestJson.previous_response_id : null;
  const inputItems = db.select().from(responseInputItems).all()
    .filter((item) => item.responseId === row.id)
    .sort((a, b) => a.itemIndex - b.itemIndex)
    .map((item) => parseJson<unknown>(item.itemJson, null));
  const output = Array.isArray(responseJson.output) ? responseJson.output : [];

  return [
    ...collectPreviousMessages(previous, auth, depth + 1),
    ...responseInputItemsToMessages(inputItems),
    ...responseOutputItemsToMessages(output)
  ];
}

function storeResponse(options: {
  id: string;
  apiKeyId: string | null;
  modelAlias: string;
  provider: string | null;
  realModel: string | null;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  inputItems: unknown[];
}): void {
  const usage = options.response.usage && typeof options.response.usage === "object"
    ? options.response.usage as Record<string, unknown>
    : {};
  const now = new Date().toISOString();

  db.insert(storedResponses).values({
    id: options.id,
    apiKeyId: options.apiKeyId,
    modelAlias: options.modelAlias,
    provider: options.provider,
    realModel: options.realModel,
    status: String(options.response.status ?? "completed"),
    requestJson: JSON.stringify(options.request),
    responseJson: JSON.stringify(options.response),
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
    totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
    createdAt: now,
    completedAt: options.response.completed_at ? new Date(Number(options.response.completed_at) * 1000).toISOString() : now,
    deletedAt: null
  }).run();

  options.inputItems.forEach((item, index) => {
    db.insert(responseInputItems).values({
      id: nanoid(),
      responseId: options.id,
      itemIndex: index,
      itemJson: JSON.stringify(item),
      createdAt: now
    }).run();
  });
}

export async function responseRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/responses", { preHandler: requireApiAuth }, async (request, reply) => {
    const parsed = responseCreateSchema.parse(request.body);
    const responseRequest = requestRecord(parsed);
    const responseId = `resp_${nanoid(32)}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const inputItems = inputItemsFromResponseInput(parsed.input);

    // Uncensored mode: strip instructions, strip system messages, inject uncensored prompt
    const uncensored = isUncensoredAlias(parsed.model);
    const effectiveInstructions = uncensored
      ? uncensoredInstructions()
      : parsed.instructions;

    const messages = [
      ...collectPreviousMessages(parsed.previous_response_id, request.auth),
      ...responseInputItemsToMessages(inputItems, effectiveInstructions)
    ];

    if (uncensored) {
      // Apply transform again to catch system messages from previous_response_id chain
      const transformed = applyUncensoredTransform(messages);
      messages.length = 0;
      messages.push(...transformed);
    }

    if (messages.length === 0) {
      throw new GatewayError("Response input must contain at least one message.", {
        code: "invalid_request",
        statusCode: 400,
        param: "input"
      });
    }

    const internal = buildInternalChatRequest({
      responseRequest,
      messages,
      requestId: request.requestId
    });

    if (parsed.stream) {
      internal.stream = true;
      const result = await executeStreamWithFallback(internal, request.auth.apiKeyId);
      const responseStream = createResponsesSseStream(result.stream, {
        responseId,
        createdAt,
        model: parsed.model,
        request: responseRequest,
        onComplete: (finalResponse, usage) => {
          if (parsed.store !== false) {
            storeResponse({
              id: responseId,
              apiKeyId: request.auth.apiKeyId,
              modelAlias: parsed.model,
              provider: result.provider,
              realModel: result.realModel,
              request: responseRequest,
              response: finalResponse,
              inputItems
            });
          }
          // Log with REAL token counts from the stream's final chunk
          const inputTokens = usage?.input_tokens;
          const outputTokens = usage?.output_tokens;
          logRequest({
            requestId: request.requestId,
            apiKeyId: request.auth.apiKeyId,
            modelAlias: parsed.model,
            provider: result.provider,
            realModel: result.realModel,
            status: "success",
            latencyMs: Date.now() - result.started,
            inputTokens,
            outputTokens,
            estimatedCost: estimateCostUsd(result.realModel, inputTokens, outputTokens)
          });
        }
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-request-id": request.requestId
      });

      const reader = responseStream.getReader();
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
          // ignore close failures
        }
      }
      return;
    }

    const result = await executeWithFallback(internal, request.auth.apiKeyId);
    const output = responseOutputFromProvider(result.response);
    const usage = usageFromProvider(result.response);
    const responseBody = buildResponseObject({
      id: responseId,
      createdAt,
      completedAt: Math.floor(Date.now() / 1000),
      status: "completed",
      model: parsed.model,
      request: responseRequest,
      output,
      usage
    });

    if (parsed.store !== false) {
      storeResponse({
        id: responseId,
        apiKeyId: request.auth.apiKeyId,
        modelAlias: parsed.model,
        provider: result.provider,
        realModel: result.realModel,
        request: responseRequest,
        response: responseBody,
        inputItems
      });
    }

    return responseBody;
  });

  app.get("/v1/responses/:response_id", { preHandler: requireApiAuth }, async (request) => {
    const params = z.object({ response_id: z.string().min(1) }).parse(request.params);
    const row = getStoredResponse(params.response_id, request.auth);
    return parseJson<Record<string, unknown>>(row.responseJson, {});
  });

  app.delete("/v1/responses/:response_id", { preHandler: requireApiAuth }, async (request) => {
    const params = z.object({ response_id: z.string().min(1) }).parse(request.params);
    const row = getStoredResponse(params.response_id, request.auth);
    db.update(storedResponses).set({ deletedAt: new Date().toISOString() }).where(eq(storedResponses.id, row.id)).run();
    return {
      id: row.id,
      object: "response.deleted",
      deleted: true
    };
  });

  app.post("/v1/responses/:response_id/cancel", { preHandler: requireApiAuth }, async (request) => {
    const params = z.object({ response_id: z.string().min(1) }).parse(request.params);
    const row = getStoredResponse(params.response_id, request.auth);

    if (row.status === "completed") {
      throw new GatewayError("Cannot cancel a completed response.", {
        code: "response_already_completed",
        statusCode: 409,
        param: "response_id"
      });
    }

    const responseJson = parseJson<Record<string, unknown>>(row.responseJson, {});
    responseJson.status = "cancelled";
    responseJson.completed_at = Math.floor(Date.now() / 1000);
    db.update(storedResponses)
      .set({
        status: "cancelled",
        responseJson: JSON.stringify(responseJson),
        completedAt: new Date().toISOString()
      })
      .where(eq(storedResponses.id, row.id))
      .run();
    return responseJson;
  });

  app.get("/v1/responses/:response_id/input_items", { preHandler: requireApiAuth }, async (request) => {
    const params = z.object({ response_id: z.string().min(1) }).parse(request.params);
    const row = getStoredResponse(params.response_id, request.auth);
    const items = db.select().from(responseInputItems).all()
      .filter((item) => item.responseId === row.id)
      .sort((a, b) => a.itemIndex - b.itemIndex)
      .map((item) => ({
        id: item.id,
        object: "response.input_item",
        response_id: item.responseId,
        item: parseJson<unknown>(item.itemJson, null)
      }));

    return {
      object: "list",
      data: items,
      first_id: items[0]?.id ?? null,
      last_id: items[items.length - 1]?.id ?? null,
      has_more: false
    };
  });
}
