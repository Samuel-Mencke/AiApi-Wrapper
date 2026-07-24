import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    service: env.SERVICE_NAME,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    promptLogging: env.ENABLE_PROMPT_LOGGING
  }));
}
