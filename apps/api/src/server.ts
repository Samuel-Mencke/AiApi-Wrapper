import cors from "@fastify/cors";
import Fastify from "fastify";
import { eq } from "drizzle-orm";
import { migrate } from "./db/client.js";
import { db } from "./db/client.js";
import { apiKeys } from "./db/schema.js";
import { hashApiKey } from "./middleware/auth.js";
import { env } from "./env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { registerRateLimit } from "./middleware/rate-limit.js";
import { chatCompletionRoutes } from "./routes/chat-completions.js";
import { healthRoutes } from "./routes/health.js";
import { modelRoutes } from "./routes/models.js";
import { adminAuthRoutes } from "./routes/admin-auth.js";
import { adminApiKeyRoutes } from "./routes/admin-api-keys.js";
import { adminLogRoutes } from "./routes/admin-logs.js";
import { adminModelRoutes } from "./routes/admin-models.js";
import { adminProviderRoutes } from "./routes/admin-providers.js";
import { adminStatsRoutes } from "./routes/admin-stats.js";
import { syncConfigToDatabase } from "./config/providers.js";

const SYSTEM_KEY_ID = "system";

const app = Fastify({
  logger: {
    level: "info"
  }
});

app.setErrorHandler(errorHandler);

await app.register(cors, {
  origin: true,
  credentials: true
});
await registerRateLimit(app);

migrate();
syncConfigToDatabase();

// Ensure the internal system API key exists for admin testing
// Uses the GATEWAY_MASTER_KEY as the actual key so it bypasses auth checks
const existing = db.select().from(apiKeys).where(eq(apiKeys.id, SYSTEM_KEY_ID)).get();
if (!existing) {
  db.insert(apiKeys).values({
    id: SYSTEM_KEY_ID,
    name: "_system",
    keyHash: hashApiKey(env.GATEWAY_MASTER_KEY),
    enabled: true,
    createdAt: new Date().toISOString()
  }).run();
  app.log.info("Created internal system API key for admin testing");
}

await app.register(healthRoutes);
await app.register(adminAuthRoutes);
await app.register(modelRoutes);
await app.register(chatCompletionRoutes);
await app.register(adminStatsRoutes);
await app.register(adminProviderRoutes);
await app.register(adminModelRoutes);
await app.register(adminApiKeyRoutes);
await app.register(adminLogRoutes);

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
