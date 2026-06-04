import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { GatewayError } from "@ai-gateway/core/errors";

/**
 * OpenAI-compatible error handler.
 * Format: { error: { message, type, code } }
 * See: https://platform.openai.com/docs/guides/error-codes/api-errors
 */
export async function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (error instanceof GatewayError) {
    await reply.code(error.statusCode).send({
      error: {
        message: error.message,
        type: openAIErrorType(error.statusCode),
        code: error.code,
      }
    });
    return;
  }

  await reply.code(error.statusCode ?? 500).send({
    error: {
      message: error.message || "Internal server error",
      type: openAIErrorType(error.statusCode ?? 500),
      code: "internal_error",
    }
  });
}

function openAIErrorType(statusCode: number): string {
  switch (statusCode) {
    case 400: return "invalid_request_error";
    case 401: return "authentication_error";
    case 403: return "permission_error";
    case 404: return "not_found_error";
    case 422: return "invalid_request_error";
    case 429: return "rate_limit_error";
    case 500:
    case 502:
    case 503: return "server_error";
    default: return "api_error";
  }
}
