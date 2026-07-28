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
import { acquireProviderPriority, isBackgroundRequest, type PriorityLease } from "./priority.js";
import { addRequestAbortSignal, getRequestAbortSignal, requestWasAborted, sleepWithRequestAbort } from "./request-control.js";
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

function retryDelayMs(round: number): number {
  return Math.min(30_000, 2_000 * (2 ** Math.min(round, 4)));
}

function cleanupLease(lease: PriorityLease | undefined, removeSignal: () => void): void {
  removeSignal();
  lease?.release();
}

function wrapStreamWithCleanup(
  source: ReadableStream<Uint8Array>,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let cleaned = false;
  const finish = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
}

export async function executeWithFallback(
  request: InternalChatRequest,
  apiKeyId: string | null,
): Promise<ExecuteResult> {
  const route = resolveModel(request.modelAlias);
  const background = isBackgroundRequest(apiKeyId);
  const persistentRetries = !background && getRequestAbortSignal(request) !== undefined;
  let lastError: GatewayError | null = null;
  let round = 0;

  while (true) {
    let roundHadRetryableError = false;
    for (const target of route.attempts) {
      const started = Date.now();
      let lease: PriorityLease | undefined;
      let removePrioritySignal = () => {};
      try {
        lease = await acquireProviderPriority(target.provider, request, background);
        if (lease.signal) {
          removePrioritySignal = addRequestAbortSignal(request, lease.signal);
        }
        const providerConfig = getProviderConfig(target.provider);
        const adapter = adapters[providerConfig.type] ?? adapters[target.provider];
        if (!adapter) {
          throw new GatewayError(`No adapter registered for ${providerConfig.type}`, {
            code: "adapter_not_found",
            statusCode: 500
          });
        }
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
        roundHadRetryableError ||= gatewayError.retryable;
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
      } finally {
        cleanupLease(lease, removePrioritySignal);
      }
    }

    if (!persistentRetries || requestWasAborted(request) || !roundHadRetryableError) break;
    await sleepWithRequestAbort(request, retryDelayMs(round));
    round += 1;
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
  const background = isBackgroundRequest(apiKeyId);
  const persistentRetries = !background && getRequestAbortSignal(request) !== undefined;
  let lastError: GatewayError | null = null;
  let round = 0;

  while (true) {
    let roundHadRetryableError = false;
    for (const target of route.attempts) {
      const started = Date.now();
      let lease: PriorityLease | undefined;
      let removePrioritySignal = () => {};
      let handedOff = false;
      try {
        lease = await acquireProviderPriority(target.provider, request, background);
        if (lease.signal) {
          removePrioritySignal = addRequestAbortSignal(request, lease.signal);
        }
        const providerConfig = getProviderConfig(target.provider);
        const adapter = adapters[providerConfig.type] ?? adapters[target.provider];
        enforceRouteQuota(request.modelAlias, target);
        if (!adapter?.supportsStreaming || !adapter.stream) {
          throw new GatewayError(`Provider '${target.provider}' does not support streaming yet`, {
            code: "streaming_not_supported",
            statusCode: 501,
            retryable: false
          });
        }

        const providerStream = await adapter.stream(request, target, providerConfig);
        const cleanup = () => cleanupLease(lease, removePrioritySignal);
        const stream = wrapStreamWithCleanup(providerStream, cleanup);
        handedOff = true;
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
        roundHadRetryableError ||= gatewayError.retryable;
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
      } finally {
        if (!handedOff) cleanupLease(lease, removePrioritySignal);
      }
    }

    if (!persistentRetries || requestWasAborted(request) || !roundHadRetryableError) break;
    await sleepWithRequestAbort(request, retryDelayMs(round));
    round += 1;
  }

  throw lastError ?? new GatewayError("All provider routes failed", { code: "all_routes_failed", statusCode: 502 });
}
