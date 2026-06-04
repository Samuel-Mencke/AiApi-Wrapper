import { estimateCostUsd } from "@ai-gateway/core/pricing";
import type { InternalChatRequest, ProviderResponse } from "@ai-gateway/core";
import { GatewayError, toGatewayError } from "@ai-gateway/core/errors";
import { anthropicAdapter } from "../providers/anthropic.js";
import { geminiAdapter } from "../providers/gemini.js";
import { createOpenAiCompatibleAdapter } from "../providers/openai-compatible.js";
import { openAiAdapter } from "../providers/openai.js";
import { openRouterAdapter } from "../providers/openrouter.js";
import type { ProviderAdapter } from "../providers/types.js";
import { logRequest } from "../middleware/request-logger.js";
import { getProviderConfig, resolveModel } from "./resolve-model.js";

const adapters: Record<string, ProviderAdapter> = {
  openai: openAiAdapter,
  openrouter: openRouterAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
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
      if (request.stream) {
        throw new GatewayError("Use executeStreamWithFallback for streaming requests", {
          code: "internal_stream_routing_error",
          statusCode: 500
        });
      }
      const response = await adapter.complete(request, target, providerConfig);
      const latencyMs = Date.now() - started;
      logRequest({
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

export async function executeStreamWithFallback(
  request: InternalChatRequest,
  apiKeyId: string | null,
): Promise<{ stream: ReadableStream<Uint8Array>; provider: string; realModel: string; started: number }> {
  const route = resolveModel(request.modelAlias);
  let lastError: GatewayError | null = null;

  for (const target of route.attempts) {
    const providerConfig = getProviderConfig(target.provider);
    const adapter = adapters[providerConfig.type] ?? adapters[target.provider];
    const started = Date.now();

    try {
      if (!adapter?.supportsStreaming || !adapter.stream) {
        throw new GatewayError(`Provider '${target.provider}' does not support streaming yet`, {
          code: "streaming_not_supported",
          statusCode: 501,
          retryable: false
        });
      }

      const stream = await adapter.stream(request, target, providerConfig);
      logRequest({
        apiKeyId,
        modelAlias: request.modelAlias,
        provider: target.provider,
        realModel: target.model,
        status: "success",
        latencyMs: Date.now() - started
      });
      return { stream, provider: target.provider, realModel: target.model, started };
    } catch (error) {
      const gatewayError = toGatewayError(error);
      lastError = gatewayError;
      logRequest({
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
