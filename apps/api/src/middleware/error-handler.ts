import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { GatewayError } from "@model-console/core/errors";
import { ZodError } from "zod";

/**
 * OpenAI-compatible error handler.
 * Format: { error: { message, type, code } }
 * See: https://platform.openai.com/docs/guides/error-codes/api-errors
 */
export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const requestId = request.requestId;
  if (requestId) {
    reply.header("x-request-id", requestId);
  }

  if (error instanceof GatewayError) {
    if (error.retryAfter !== null) {
      reply.header("retry-after", String(error.retryAfter));
    }
    await reply.code(error.statusCode).send({
      error: {
        message: error.message,
        type: openAIErrorType(error.statusCode),
        param: error.param,
        code: error.code,
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const param = issue?.path.map(String).join(".") || null;
    await reply.code(400).send({
      error: {
        message: issue ? `${param ?? "request"}: ${issue.message}` : "Invalid request body",
        type: "invalid_request_error",
        param,
        code: "invalid_request"
      }
    });
    return;
  }

  await reply.code(error.statusCode ?? 500).send({
    error: {
      message: error.message || "Internal server error",
      type: openAIErrorType(error.statusCode ?? 500),
      param: null,
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
    case 409: return "invalid_request_error";
    case 422: return "invalid_request_error";
    case 429: return "rate_limit_error";
    case 500:
    case 502:
    case 503:
    case 504: return "server_error";
    default: return "api_error";
  }
}
