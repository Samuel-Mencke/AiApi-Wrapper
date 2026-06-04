import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { GatewayError } from "@ai-gateway/core/errors";

export async function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (error instanceof GatewayError) {
    await reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  await reply.code(error.statusCode ?? 500).send({
    error: {
      code: "internal_error",
      message: error.message || "Internal server error"
    }
  });
}
