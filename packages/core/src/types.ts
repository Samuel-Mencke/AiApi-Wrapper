export type InternalRole = "system" | "user" | "assistant" | "tool";

export interface InternalMessage {
  role: InternalRole;
  content: string | Array<Record<string, unknown>> | null;
  name?: string;
  toolCallId?: string;
  toolCalls?: unknown[];
  reasoningContent?: string;
  thinkingContent?: string;
}

export interface InternalChatRequest {
  modelAlias: string;
  messages: InternalMessage[];
  requestId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxCompletionTokens?: number;
  stream?: boolean;
  streamOptions?: Record<string, unknown>;
  stop?: string | string[];
  n?: number;
  seed?: number;
  tools?: unknown[];
  toolChoice?: unknown;
  parallelToolCalls?: boolean;
  responseFormat?: unknown;
  extraBody?: Record<string, unknown>;
  gateway?: {
    includeReasoning?: boolean;
  };
}

export interface ModelRouteTarget {
  provider: string;
  model: string;
  baseUrl?: string;
}

export interface ModelRouteConfig extends ModelRouteTarget {
  alias: string;
  enabled: boolean;
  fallback: ModelRouteTarget[];
  createdAt?: string;
}

export interface ProviderConfig {
  name: string;
  type: "openai" | "openrouter" | "gemini" | "anthropic" | "custom";
  baseUrl?: string;
  enabled: boolean;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderResponse {
  id: string;
  provider: string;
  model: string;
  content: unknown;
  reasoningText?: string;
  thinkingText?: string;
  toolCalls?: unknown[];
  finishReason?: string | null;
  usage?: ProviderUsage;
  raw: unknown;
}

export interface GatewayStats {
  requestsToday: number;
  totalRequests: number;
  averageLatencyMs: number;
  errorRate: number;
  estimatedCost: number;
  activeProviders: number;
  requestsOverTime: Array<{ time: string; requests: number; errors: number }>;
  costByProvider: Array<{ provider: string; cost: number }>;
  latencyByProvider: Array<{ provider: string; latencyMs: number }>;
}
