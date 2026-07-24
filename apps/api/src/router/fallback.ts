import { estimateCostUsd } from "@model-console/core/pricing";
import type { InternalChatRequest, ProviderResponse } from "@model-console/core";
import { GatewayError, toGatewayError } from "@model-console/core/errors";
import { anthropicAdapter } from "../providers/anthropic.js";
import { chatgptWebAdapter } from "../providers/chatgpt-web.js";
import { geminiAdapter } from "../providers/gemini.js";
import { createOpenAiCompatibleAdapter } from "../providers/openai-compatible.js";
import { openAiAdapter } from "../providers/openai.js";
import { openRouterAdapter } from "../providers/openrouter.js";
import type { ProviderAdapter } from "../providers/types.js";
import { logRequest } from "../middleware/request-logger.js";
import { enforceRouteQuota } from "./quota.js";
import { getProviderConfig, resolveModel } from "./resolve-model.js";

const adapters: Record<string, ProviderAdapter> = {
  openai: openAiAdapter,
  openrouter: openRouterAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  "chatgpt-web": chatgptWebAdapter,
  custom: createOpenAiCompatibleAdapter("custom")
};

export interface ExecuteResult {
  response: ProviderResponse;
  provider: string;
  realModel: string;
  latencyMs: number;
}

export async function executeWithFallback(
  request: InternalChatRequest,
  apiKeyId: string | null,
): Promise<ExecuteResult> {
  const route = resolveModel(request.modelAlias);
  let lastError: GatewayError | null = null;

  for (const target of route.attempts) {
    const providerConfig = getProviderConfig(target.provider);
    const adapter = adapters[providerConfig.type] ?? adapters[target.provider];
    if (!adapter) {
      lastError = new GatewayError(`No adapter registered for ${providerConfig.type}`, {
        code: "adapter_not_found",
        statusCode: 500
      });
      continue;
    }

    const started = Date.now();
    try {
      enforceRouteQuota(request.modelAlias, target);
      if (request.stream) {
        throw new GatewayError("Use executeStreamWithFallback for streaming requests", {
          code: "internal_stream_routing_error",
          statusCode: 500
        });
      }
      const response = await adapter.complete(request, target, providerConfig);
      const latencyMs = Date.now() - started;
      logRequest({
        requestId: request.requestId,
        apiKeyId,
        modelAlias: request.modelAlias,
        provider: target.provider,
        realModel: target.model,
        status: "success",
        latencyMs,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        estimatedCost: estimateCostUsd(target.model, response.usage?.inputTokens, response.usage?.outputTokens)
      });
      return { response, provider: target.provider, realModel: target.model, latencyMs };
    } catch (error) {
      const gatewayError = toGatewayError(error);
      lastError = gatewayError;
      logRequest({
        requestId: request.requestId,
        apiKeyId,
        modelAlias: request.modelAlias,
        provider: target.provider,
        realModel: target.model,
        status: "error",
        latencyMs: Date.now() - started,
        errorCode: gatewayError.code,
        errorMessage: gatewayError.message
      });

      if (!gatewayError.retryable) {
        throw gatewayError;
      }
    }
  }

  throw lastError ?? new GatewayError("All provider routes failed", { code: "all_routes_failed", statusCode: 502 });
}

/**
 * Context returned alongside a streaming response so the caller can log
 * the request with REAL token counts after the stream finishes.
 * Usage data arrives in the final SSE chunk — long after we return the stream.
 */
export interface StreamLogContext {
  requestId?: string;
  apiKeyId: string | null;
  modelAlias: string;
  provider: string;
  realModel: string;
  started: number;
}

export async function executeStreamWithFallback(
  request: InternalChatRequest,
  apiKeyId: string | null,
): Promise<{ stream: ReadableStream<Uint8Array>; provider: string; realModel: string; started: number; logContext: StreamLogContext }> {
  const route = resolveModel(request.modelAlias);
  let lastError: GatewayError | null = null;

  for (const target of route.attempts) {
    const providerConfig = getProviderConfig(target.provider);
    const adapter = adapters[providerConfig.type] ?? adapters[target.provider];
    const started = Date.now();

    try {
      enforceRouteQuota(request.modelAlias, target);
      if (!adapter?.supportsStreaming || !adapter.stream) {
        throw new GatewayError(`Provider '${target.provider}' does not support streaming yet`, {
          code: "streaming_not_supported",
          statusCode: 501,
          retryable: false
        });
      }

      const stream = await adapter.stream(request, target, providerConfig);
      // NOTE: Do NOT log success here — usage data is not available until the stream ends.
      // The caller is responsible for calling logRequest with real token counts
      // after consuming the stream (via StreamLogContext).
      return {
        stream,
        provider: target.provider,
        realModel: target.model,
        started,
        logContext: {
          requestId: request.requestId,
          apiKeyId,
          modelAlias: request.modelAlias,
          provider: target.provider,
          realModel: target.model,
          started,
        },
      };
    } catch (error) {
      const gatewayError = toGatewayError(error);
      lastError = gatewayError;
      logRequest({
        requestId: request.requestId,
        apiKeyId,
        modelAlias: request.modelAlias,
        provider: target.provider,
        realModel: target.model,
        status: "error",
        latencyMs: Date.now() - started,
        errorCode: gatewayError.code,
        errorMessage: gatewayError.message
      });

      if (!gatewayError.retryable) {
        throw gatewayError;
      }
    }
  }

  throw lastError ?? new GatewayError("All provider routes failed", { code: "all_routes_failed", statusCode: 502 });
}
