import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../env.js";

/**
 * Auto-discoverable OpenAPI 3.0 specification.
 * Any AI agent can fetch GET /v1/openapi.json or GET /.well-known/ai-plugin.json
 * to understand every endpoint, its parameters, auth, and response shapes —
 * without any human explanation.
 */

const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Unified Model API",
    description: "Self-hosted OpenAI-compatible model API with chat completions, Responses API support, audio transcription, model routing, and administration. Public model endpoints use Bearer authentication with MASTER_API_KEY or generated API keys.",
    version: "1.0.0",
  },
  servers: [
    { url: env.PUBLIC_BASE_URL, description: "Configured public endpoint" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Use MASTER_API_KEY or a generated API key as the Bearer token.",
      },
    },
    schemas: {
      ChatCompletionRequest: {
        type: "object",
        required: ["model", "messages"],
        properties: {
          model: { type: "string", description: "Model alias (e.g. glm5.1, glm-4.5). GET /v1/models for full list.", example: "glm5.1" },
          messages: {
            type: "array",
            items: {
              type: "object",
              required: ["role", "content"],
              properties: {
                role: { type: "string", enum: ["system", "user", "assistant", "developer"], description: "System prompts are stripped in -u (uncensored) mode." },
                content: { type: "string", description: "Message content. Can include text, code, HTML." },
              },
            },
          },
          stream: { type: "boolean", default: false, description: "Enable SSE streaming response." },
          temperature: { type: "number", default: 0.7, minimum: 0, maximum: 2 },
          max_tokens: { type: "integer", minimum: 1, description: "Max output tokens." },
          "reasoning_effort": { type: "string", enum: ["low", "medium", "high"], description: "Controls reasoning depth (ignored by z.ai, use thinking param instead)." },
        },
      },
      ChatCompletionResponse: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string", example: "chat.completion" },
          model: { type: "string" },
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                message: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    content: { type: "string" },
                  },
                },
                finish_reason: { type: "string" },
              },
            },
          },
          usage: {
            type: "object",
            properties: {
              prompt_tokens: { type: "integer" },
              completion_tokens: { type: "integer" },
              total_tokens: { type: "integer" },
            },
          },
        },
      },
      AudioTranscriptionRequest: {
        type: "object",
        description: "Multipart form data. Send audio file as 'file' field.",
        properties: {
          file: { type: "string", format: "binary", description: "Audio file: webm, wav, mp3, ogg, m4a. Max 15MB." },
          language: { type: "string", default: "de", description: "Primary language. 'de' optimized with English hotwords (Gaming, Streaming, Laptop, etc.)." },
          response_format: { type: "string", enum: ["json", "text", "verbose_json"], default: "json", description: "json={text}, text=plain text, verbose_json includes timestamps." },
          prompt: { type: "string", description: "Hotwords hint to improve recognition of specific terms." },
        },
      },
      AudioTranscriptionResponse: {
        type: "object",
        properties: {
          text: { type: "string", description: "Full transcribed text." },
          language: { type: "string", description: "Detected language code." },
          language_probability: { type: "number", description: "Language detection confidence (0-1)." },
          duration: { type: "number", description: "Audio duration in seconds." },
          segments: {
            type: "array",
            description: "Only in verbose_json. Timestamped segments.",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                start: { type: "number", description: "Start time in seconds." },
                end: { type: "number", description: "End time in seconds." },
                text: { type: "string" },
              },
            },
          },
        },
      },
      Model: {
        type: "object",
        properties: {
          id: { type: "string", description: "Model alias to use in chat completions." },
          object: { type: "string", example: "model" },
          created: { type: "integer" },
          owned_by: { type: "string", description: "Provider name." },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Service health check",
        description: "Returns service status. No authentication is required.",
        security: [],
        responses: { "200": { description: "Service status", content: { "application/json": { schema: { type: "object", properties: { status: { type: "string" }, service: { type: "string" } } } } } } },
      },
    },
    "/v1/models": {
      get: {
        summary: "List all available models",
        description: "Returns all enabled models. Append '-u' to any model name for uncensored mode. Example: glm5.1-u",
        security: [{ BearerAuth: [] }],
        responses: { "200": { description: "Model list", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Model" } } } } } } } },
      },
    },
    "/v1/chat/completions": {
      post: {
        summary: "Chat completion (OpenAI-compatible)",
        description: "Send messages and get AI-generated responses. Supports streaming (SSE). Append '-u' to the model name for uncensored mode. Example: { model: 'glm5.1-u', messages: [...] }",
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ChatCompletionRequest" } } } },
        responses: {
          "200": { description: "Completion", content: { "application/json": { schema: { $ref: "#/components/schemas/ChatCompletionResponse" } } } },
          "401": { description: "Invalid API key" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/v1/responses": {
      post: {
        summary: "Responses API (OpenAI-compatible)",
        description: "Alternative to chat completions. Supports streaming, function calling, and tool use. Same model aliases and -u uncensored mode.",
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: {
          model: { type: "string", example: "glm5.1" },
          input: { description: "String or array of input items." },
          stream: { type: "boolean", default: false },
          instructions: { type: "string", description: "System-level instructions (stripped in -u mode)." },
        } } } } },
        responses: { "200": { description: "Response object" } },
      },
    },
    "/v1/audio/transcriptions": {
      post: {
        summary: "Audio to text (Speech-to-Text)",
        description: "Transcribe audio files using Whisper large-v3. Optimized for German with English mixed-in words (Denglisch). Supports webm, wav, mp3, ogg, m4a. Max 15MB. Model lazy-loads on first request (~5s first time), unloads after 10min idle.",
        security: [{ BearerAuth: [] }],
        requestBody: { required: true, content: { "multipart/form-data": { schema: { $ref: "#/components/schemas/AudioTranscriptionRequest" } } } },
        responses: {
          "200": { description: "Transcription", content: { "application/json": { schema: { $ref: "#/components/schemas/AudioTranscriptionResponse" } } } },
          "400": { description: "No audio file provided" },
          "401": { description: "Invalid API key" },
          "503": { description: "Whisper service unavailable" },
        },
      },
    },
  },
};

// ── AI Plugin manifest (OpenAI GPT / plugin standard) ────────────
const AI_PLUGIN_MANIFEST = {
  schema_version: "v1",
  name_for_human: "Model API",
  name_for_model: "model_api",
  description_for_human: "OpenAI-compatible model API with chat completions, speech-to-text, and routing.",
  description_for_model: "Self-hosted OpenAI-compatible model API. Use POST /v1/chat/completions for messages, POST /v1/responses for Responses API clients, POST /v1/audio/transcriptions for speech-to-text, and GET /v1/models to discover model aliases. Public model endpoints require Bearer authentication.",
  auth: { type: "service_http", authorization_type: "bearer", verification_tokens: {} },
  api: { type: "openapi", url: `${env.PUBLIC_BASE_URL}/.well-known/openapi.json`, has_user_authentication: false },
  legal_info_url: env.PUBLIC_BASE_URL,
};

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  // OpenAPI spec
  app.get("/.well-known/openapi.json", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(OPENAPI_SPEC);
  });

  // Also at /v1/openapi.json for convenience
  app.get("/v1/openapi.json", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(OPENAPI_SPEC);
  });

  // AI Plugin manifest (GPT plugin standard)
  app.get("/.well-known/ai-plugin.json", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(AI_PLUGIN_MANIFEST);
  });
}
