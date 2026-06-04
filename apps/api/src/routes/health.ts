import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: "ai-gateway",
    publicBaseUrl: env.PUBLIC_BASE_URL,
    promptLogging: env.ENABLE_PROMPT_LOGGING
  }));
}
