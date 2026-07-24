import type { InternalChatRequest, ModelRouteTarget, ProviderConfig, ProviderResponse } from "@model-console/core";

export interface ProviderAdapter {
  name: string;
  supportsStreaming: boolean;
  complete(request: InternalChatRequest, target: ModelRouteTarget, config: ProviderConfig): Promise<ProviderResponse>;
  stream?(
    request: InternalChatRequest,
    target: ModelRouteTarget,
    config: ProviderConfig,
  ): Promise<ReadableStream<Uint8Array>>;
  test(config: ProviderConfig): Promise<{ ok: boolean; message: string }>;
}
