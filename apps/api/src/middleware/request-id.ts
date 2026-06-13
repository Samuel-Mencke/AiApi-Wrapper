import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";

declare module "fastify" {
  interface FastifyRequest {
    requestId: string;
  }
}

export async function registerRequestId(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    const incoming = request.headers["x-request-id"];
    const value = Array.isArray(incoming) ? incoming[0] : incoming;
    request.requestId = value && value.trim().length > 0 ? value.trim() : `req_${nanoid(24)}`;
    reply.header("x-request-id", request.requestId);
  });
}
