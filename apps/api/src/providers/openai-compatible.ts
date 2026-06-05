import { GatewayError, isRetryableStatus } from "@ai-gateway/core/errors";
import type { InternalChatRequest, ModelRouteTarget, ProviderConfig, ProviderResponse } from "@ai-gateway/core";
import { getProviderApiKey } from "../config/providers.js";
import type { ProviderAdapter } from "./types.js";

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai"
};

function baseUrl(config: ProviderConfig, target: ModelRouteTarget): string {
  return (target.baseUrl ?? config.baseUrl ?? DEFAULT_BASE_URLS[config.name] ?? config.baseUrl ?? "").replace(/\/$/, "");
}

function headers(config: ProviderConfig): HeadersInit {
  const apiKey = getProviderApiKey(config.name);
  if (!apiKey && config.type !== "custom") {
    throw new GatewayError(`Missing API key for provider ${config.name}`, {
      code: "missing_provider_api_key",
      statusCode: 400
    });
  }

  const value: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    value.Authorization = `Bearer ${apiKey}`;
  }
  if (config.name === "openrouter") {
    value["HTTP-Referer"] = "http://localhost";
    value["X-Title"] = "ai-gateway";
  }
  return value;
}

function body(request: InternalChatRequest, target: ModelRouteTarget, stream: boolean, providerName?: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    model: target.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
      name: message.name,
      tool_call_id: message.toolCallId
    })),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    tools: request.tools,
    stream_options: request.streamOptions,
    stream
  };

  // Forward extra_body fields (e.g. thinking, reasoning for Z.ai/GLM)
  if (request.extraBody && typeof request.extraBody === "object") {
    Object.assign(result, request.extraBody);
  }

  return result;
}

async function handleProviderError(response: Response, provider: string): Promise<never> {
  let message = `${provider} returned HTTP ${response.status}`;
  try {
    const json = (await response.json()) as { error?: { message?: string; code?: string } };
    message = json.error?.message ?? message;
  } catch {
    // Response body is not JSON; keep the HTTP status message.
  }

  throw new GatewayError(message, {
    code: "provider_http_error",
    statusCode: response.status,
    retryable: isRetryableStatus(response.status)
  });
}

export function createOpenAiCompatibleAdapter(name: string): ProviderAdapter {
  return {
    name,
    supportsStreaming: true,
    async complete(request, target, config): Promise<ProviderResponse> {
      const url = `${baseUrl(config, target)}/chat/completions`;
      const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify(body(request, target, false, config.name)),
        signal: AbortSignal.timeout(60_000)
      }).catch((error: unknown) => {
        throw new GatewayError(error instanceof Error ? error.message : "Provider network error", {
          code: "provider_network_error",
          statusCode: 502,
          retryable: true
        });
      });

      if (!response.ok) {
        await handleProviderError(response, config.name);
      }

      const json = (await response.json()) as {
        id?: string;
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      return {
        id: json.id ?? `gw-${Date.now()}`,
        provider: config.name,
        model: target.model,
        content: json.choices?.[0]?.message?.content ?? "",
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
          totalTokens: json.usage?.total_tokens
        },
        raw: json
      };
    },
    async stream(request, target, config): Promise<ReadableStream<Uint8Array>> {
      const url = `${baseUrl(config, target)}/chat/completions`;
      const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify(body(request, target, true, config.name)),
        signal: AbortSignal.timeout(60_000)
      }).catch((error: unknown) => {
        throw new GatewayError(error instanceof Error ? error.message : "Provider network error", {
          code: "provider_network_error",
          statusCode: 502,
          retryable: true
        });
      });

      if (!response.ok) {
        await handleProviderError(response, config.name);
      }
      if (!response.body) {
        throw new GatewayError("Provider did not return a stream body", {
          code: "provider_stream_unavailable",
          statusCode: 502,
          retryable: true
        });
      }
      return response.body;
    },
    async test(config): Promise<{ ok: boolean; message: string }> {
      const url = `${baseUrl(config, { provider: config.name, model: "test" })}/models`;
      try {
        const response = await fetch(url, {
          headers: headers(config),
          signal: AbortSignal.timeout(10_000)
        });
        return { ok: response.ok, message: response.ok ? "Provider reachable" : `HTTP ${response.status}` };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "Provider test failed" };
      }
    }
  };
}
