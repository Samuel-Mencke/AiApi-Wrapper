import type { FastifyInstance } from "fastify";
import { GatewayError } from "@ai-gateway/core/errors";
import { requireApiAuth } from "../middleware/auth.js";
import { executeStreamWithFallback, executeWithFallback } from "../router/fallback.js";
import { normalizeRequest } from "../router/normalize-request.js";
import { toOpenAiChatResponse } from "../router/normalize-response.js";

export async function chatCompletionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/chat/completions", { preHandler: requireApiAuth }, async (request, reply) => {
    const internal = normalizeRequest(request.body);

    if (internal.stream) {
      const result = await executeStreamWithFallback(internal, request.auth.apiKeyId);
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      const reader = result.stream.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          reply.raw.write(Buffer.from(chunk.value));
        }
        reply.raw.end();
      } catch (error) {
        throw new GatewayError(error instanceof Error ? error.message : "Streaming failed", {
          code: "stream_proxy_error",
          statusCode: 502,
          retryable: false
        });
      }
      return reply;
    }

    const result = await executeWithFallback(internal, request.auth.apiKeyId);
    return toOpenAiChatResponse(internal, result.response);
  });
}
