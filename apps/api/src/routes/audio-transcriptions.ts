import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayError } from "@model-console/core/errors";
import { requireAdminAuth, requireApiAuth } from "../middleware/auth.js";

const WHISPER_URL = process.env.WHISPER_SERVICE_URL ?? "http://127.0.0.1:5006";

type MultipartField = { value?: unknown };

function collectFields(rawFields: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(rawFields)) {
    if (key === "file") continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const lastValue = values.at(-1) as MultipartField | undefined;
    if (lastValue && typeof lastValue === "object" && typeof lastValue.value === "string") {
      fields[key] = lastValue.value;
    }
  }

  return fields;
}

async function forwardTranscription(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const data = await request.file();
  if (!data) {
    throw new GatewayError("No audio file provided. Send a multipart 'file' field.", {
      code: "no_audio_file",
      statusCode: 400,
    });
  }

  const buffer = await data.toBuffer();
  const fields = collectFields(data.fields as Record<string, unknown>);
  const formData = new FormData();
  const audioBytes = new Uint8Array(buffer);
  const audioBlob = new Blob([audioBytes], {
    type: data.mimetype || "application/octet-stream",
  });

  formData.append("file", audioBlob, data.filename || "audio.webm");
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }

  let whisperResponse: Response;
  try {
    whisperResponse = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw new GatewayError(
      error instanceof Error ? `Whisper service unavailable: ${error.message}` : "Whisper service unavailable",
      {
        code: "whisper_unavailable",
        statusCode: 503,
      },
    );
  }

  if (!whisperResponse.ok) {
    const errorBody = await whisperResponse.json().catch(() => ({}));
    throw new GatewayError(
      (errorBody as { error?: { message?: string } })?.error?.message ??
        `Whisper service error: ${whisperResponse.status}`,
      {
        code: "whisper_error",
        statusCode: whisperResponse.status,
      },
    );
  }

  const result = await whisperResponse.json();
  const responseFormat = fields.response_format ?? "json";

  if (responseFormat === "text") {
    reply.header("Content-Type", "text/plain; charset=utf-8");
    return reply.send((result as { text?: string }).text ?? "");
  }

  return reply.send(result);
}

/**
 * OpenAI-compatible audio transcription endpoints.
 *
 * POST /v1/audio/transcriptions uses gateway API-key authentication.
 * POST /admin/audio/transcriptions uses the dashboard admin session.
 */
export async function audioTranscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/audio/transcriptions",
    { preHandler: requireApiAuth },
    async (request, reply) => forwardTranscription(request, reply),
  );

  app.post(
    "/admin/audio/transcriptions",
    { preHandler: requireAdminAuth },
    async (request, reply) => forwardTranscription(request, reply),
  );

  app.get(
    "/admin/audio/transcriptions/health",
    { preHandler: requireAdminAuth },
    async (_request, reply) => {
      try {
        const response = await fetch(`${WHISPER_URL}/health`, {
          signal: AbortSignal.timeout(4_000),
        });
        if (!response.ok) {
          return reply.code(503).send({
            status: "unavailable",
            error: `Whisper service returned ${response.status}`,
          });
        }
        return reply.send(await response.json());
      } catch (error) {
        return reply.code(503).send({
          status: "unavailable",
          error: error instanceof Error ? error.message : "Whisper service unavailable",
        });
      }
    },
  );
}
