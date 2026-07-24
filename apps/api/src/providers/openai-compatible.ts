import { GatewayError, isRetryableStatus } from "@model-console/core/errors";
import type { InternalChatRequest, ModelRouteTarget, ProviderConfig, ProviderResponse } from "@model-console/core";
import { getProviderApiKey } from "../config/providers.js";
import type { ProviderAdapter } from "./types.js";

// ── Global HTTP connection pool with Keep-Alive ──
// undici is bundled with Node 18+ and powers the global fetch().
// We configure keep-alive to avoid TCP+TLS handshake on every provider request.
import undici from "undici";
undici.setGlobalDispatcher(
  new undici.Agent({
    connect: { timeout: 10_000 },
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 120_000,
    headersTimeout: 300_000,
    bodyTimeout: 300_000,
    pipelining: 0,
    connections: 100,
  })
);

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
    value["X-Title"] = "model-console";
  }
  return value;
}

function providerNetworkError(error: unknown): GatewayError {
  const message = error instanceof Error ? error.message : "Provider network error";
  const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return new GatewayError(message, {
    code: isTimeout ? "provider_timeout" : "provider_network_error",
    statusCode: isTimeout ? 504 : 502,
    retryable: true
  });
}

function body(request: InternalChatRequest, target: ModelRouteTarget, config: ProviderConfig, stream: boolean): Record<string, unknown> {
  const result: Record<string, unknown> = {
    model: target.model,
    messages: request.messages.map((message) => ({
      // The local ChatGPT OAuth proxy accepts the classic Chat Completions roles
      // but rejects the newer OpenAI `developer` role. Preserve its priority by
      // converting it to a system message only for this compatibility provider.
      role: config.name === "openai-oauth" && String(message.role) === "developer" ? "system" : message.role,
      content: message.content,
      name: message.name,
      tool_call_id: message.toolCallId,
      tool_calls: message.toolCalls,
      reasoning_content: message.reasoningContent,
      thinking_content: message.thinkingContent
    })),
    temperature: request.temperature,
    top_p: request.topP,
    max_tokens: request.maxTokens,
    max_completion_tokens: request.maxCompletionTokens,
    stop: request.stop,
    n: request.n,
    seed: request.seed,
    tools: request.tools,
    tool_choice: request.toolChoice,
    parallel_tool_calls: request.parallelToolCalls,
    response_format: request.responseFormat,
    stream_options: request.streamOptions,
    stream
  };

  // Forward extra_body fields (e.g. thinking, reasoning for Z.ai/GLM)
  if (request.extraBody && typeof request.extraBody === "object") {
    const forwardableExtraBody = { ...request.extraBody } as Record<string, unknown>;
    delete forwardableExtraBody.gateway;
    Object.assign(result, forwardableExtraBody);
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
        body: JSON.stringify(body(request, target, config, false)),
        signal: AbortSignal.timeout(60_000)
      }).catch((error: unknown) => {
        throw providerNetworkError(error);
      });

      if (!response.ok) {
        await handleProviderError(response, config.name);
      }

      const json = (await response.json()) as {
        id?: string;
        choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown; thinking_content?: unknown; tool_calls?: unknown[] }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const message = json.choices?.[0]?.message;

      return {
        id: json.id ?? `gw-${Date.now()}`,
        provider: config.name,
        model: target.model,
        content: message?.content ?? "",
        reasoningText: typeof message?.reasoning_content === "string" ? message.reasoning_content : undefined,
        thinkingText: typeof message?.thinking_content === "string" ? message.thinking_content : undefined,
        toolCalls: message?.tool_calls,
        finishReason: json.choices?.[0]?.finish_reason,
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
        body: JSON.stringify(body(request, target, config, true)),
        signal: AbortSignal.timeout(300_000)
      }).catch((error: unknown) => {
        throw providerNetworkError(error);
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
