import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import { migrate } from "./db/client.js";
import { env } from "./env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { registerRateLimit } from "./middleware/rate-limit.js";
import { registerRequestId } from "./middleware/request-id.js";
import { chatCompletionRoutes } from "./routes/chat-completions.js";
import { healthRoutes } from "./routes/health.js";
import { modelRoutes } from "./routes/models.js";
import { responseRoutes } from "./routes/responses.js";
import { adminAuthRoutes } from "./routes/admin-auth.js";
import { adminApiKeyRoutes } from "./routes/admin-api-keys.js";
import { adminLogRoutes } from "./routes/admin-logs.js";
import { adminPreferencesRoutes } from "./routes/admin-preferences.js";
import { adminModelRoutes } from "./routes/admin-models.js";
import { adminProviderRoutes } from "./routes/admin-providers.js";
import { healthProbeRoutes, startAutoProbe } from "./routes/health-probes.js";
import { adminStatsRoutes } from "./routes/admin-stats.js";
import { adminChatRoutes } from "./routes/admin-chat.js";
import { audioTranscriptionRoutes } from "./routes/audio-transcriptions.js";
import { discoveryRoutes } from "./routes/discovery.js";
import { syncConfigToDatabase } from "./config/providers.js";
import { ensureInternalChatApiKey } from "./chat/internal-api-key.js";

const app = Fastify({
  logger: {
    level: "warn"
  },
  // Performance: disable body cloning (we parse manually where needed)
  disableRequestLogging: true,
  // Trust proxy for correct IPs behind Cloudflare Tunnel
  trustProxy: true
});

app.setErrorHandler(errorHandler);

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed: ${origin}`), false);
  },
  credentials: true
});
// Multipart support for file uploads
await app.register(multipart, {
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});
// Static file serving for uploaded attachments
const uploadRoot = env.uploadPath;
fs.mkdirSync(uploadRoot, { recursive: true });
await app.register(fastifyStatic, {
  root: uploadRoot,
  prefix: "/uploads/",
  decorateReply: false
});
await registerRequestId(app);
await registerRateLimit(app);

migrate();
syncConfigToDatabase();

if (ensureInternalChatApiKey()) {
  app.log.info("Created internal system API key for admin testing");
}

await app.register(healthRoutes);
await app.register(adminAuthRoutes);
await app.register(modelRoutes);
await app.register(chatCompletionRoutes);
await app.register(responseRoutes);
await app.register(adminStatsRoutes);
await app.register(adminChatRoutes);
await app.register(audioTranscriptionRoutes);
await app.register(discoveryRoutes);
await app.register(adminProviderRoutes);
await app.register(adminModelRoutes);
await app.register(adminApiKeyRoutes);
await app.register(adminLogRoutes);
await app.register(adminPreferencesRoutes);
await app.register(healthProbeRoutes);

startAutoProbe();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
