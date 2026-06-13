import { z } from "zod";
import { db } from "../db/client.js";
import { apiKeys, modelRoutes, providers, requests } from "../db/schema.js";
import { env } from "../env.js";

export interface ToolSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface ToolExecutionResult {
  summary: string;
  sources?: ToolSource[];
  raw?: unknown;
}

export interface ChatTool<I = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  enabled: boolean;
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  timeoutMs: number;
  executor(input: I): Promise<ToolExecutionResult>;
}

export interface ToolOptions {
  webSearchEnabled?: boolean;
}

const webSearchInputSchema = z.object({
  query: z.string().min(1).max(400),
  max_results: z.coerce.number().int().positive().max(10).optional()
});

const webExtractInputSchema = z.object({
  url: z.string().url().max(2000),
  size: z.enum(["s", "m", "l"]).default("m")
});

const emptyInputSchema = z.object({}).passthrough();

function configuredSearxngUrl(): string | null {
  if (env.WEB_SEARCH_BACKEND !== "searxng" || !env.SEARXNG_URL) return null;
  return env.SEARXNG_URL.replace(/\/$/, "");
}

function ms(value: number | null | undefined) {
  if (!value) return "n/a";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value} ms`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function fallbackCount(row: typeof modelRoutes.$inferSelect) {
  try {
    return (JSON.parse(row.fallbackJson || "[]") as unknown[]).length;
  } catch {
    return 0;
  }
}

function modelMetrics() {
  const routeRows = db.select().from(modelRoutes).all();
  const requestRows = db.select().from(requests).all();
  return routeRows.map((route) => {
    const matching = requestRows.filter((request) => request.modelAlias === route.alias);
    const errors = matching.filter((request) => request.status === "error").length;
    const latest = [...matching].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      alias: route.alias,
      provider: route.provider,
      realModel: route.realModel,
      enabled: route.enabled,
      fallbackCount: fallbackCount(route),
      requestCount: matching.length,
      avgLatencyMs: matching.length ? Math.round(matching.reduce((total, request) => total + request.latencyMs, 0) / matching.length) : null,
      lastLatencyMs: latest?.latencyMs ?? null,
      errorRate: matching.length ? errors / matching.length : null,
      status: route.enabled ? "enabled" : "disabled"
    };
  });
}

function gatewayLatencyComparison(): ToolExecutionResult {
  const rows = modelMetrics().sort((a, b) => (a.avgLatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.avgLatencyMs ?? Number.MAX_SAFE_INTEGER));
  if (!rows.length) return { summary: "No configured gateway models are available.", raw: { rows } };
  const table = [
    "| Alias | Provider | Real model | Avg latency | Last request | Error rate | Fallbacks | Status |",
    "| ----- | -------- | ---------- | ----------: | -----------: | ---------: | --------: | ------ |",
    ...rows.map((row) => `| ${row.alias} | ${row.provider} | ${row.realModel} | ${ms(row.avgLatencyMs)} | ${ms(row.lastLatencyMs)} | ${percent(row.errorRate)} | ${row.fallbackCount} | ${row.status} |`)
  ].join("\n");
  return { summary: table, raw: { rows } };
}

function gatewayModelList(): ToolExecutionResult {
  const rows = modelMetrics();
  if (!rows.length) return { summary: "No configured gateway models are available.", raw: { rows } };
  return {
    summary: [
      "| Alias | Provider | Real model | Status | Fallbacks | Requests | Avg latency | Error rate |",
      "| ----- | -------- | ---------- | ------ | --------: | -------: | ----------: | ---------: |",
      ...rows.map((row) => `| ${row.alias} | ${row.provider} | ${row.realModel} | ${row.status} | ${row.fallbackCount} | ${row.requestCount} | ${ms(row.avgLatencyMs)} | ${percent(row.errorRate)} |`)
    ].join("\n"),
    raw: { rows }
  };
}

function gatewayProviderStatus(): ToolExecutionResult {
  const providerRows = db.select().from(providers).all();
  const requestRows = db.select().from(requests).all();
  if (!providerRows.length) return { summary: "No configured providers are available.", raw: { rows: [] } };
  const rows = providerRows.map((provider) => {
    const matching = requestRows.filter((request) => request.provider === provider.name);
    const errors = matching.filter((request) => request.status === "error").length;
    const avgLatency = matching.length ? Math.round(matching.reduce((total, request) => total + request.latencyMs, 0) / matching.length) : null;
    return {
      name: provider.name,
      type: provider.type,
      enabled: provider.enabled,
      requestCount: matching.length,
      avgLatencyMs: avgLatency,
      errorRate: matching.length ? errors / matching.length : null
    };
  });
  return {
    summary: [
      "| Provider | Type | Enabled | Requests | Avg latency | Error rate |",
      "| -------- | ---- | ------- | -------: | ----------: | ---------: |",
      ...rows.map((row) => `| ${row.name} | ${row.type} | ${row.enabled ? "yes" : "no"} | ${row.requestCount} | ${ms(row.avgLatencyMs)} | ${percent(row.errorRate)} |`)
    ].join("\n"),
    raw: { rows }
  };
}

function gatewayRecentErrors(): ToolExecutionResult {
  const rows = db.select().from(requests).all()
    .filter((request) => request.status === "error")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  if (!rows.length) return { summary: "No recent gateway errors are recorded.", raw: { rows } };
  return {
    summary: [
      "| Time | Alias | Provider | Real model | Code | Message |",
      "| ---- | ----- | -------- | ---------- | ---- | ------- |",
      ...rows.map((row) => `| ${row.createdAt} | ${row.modelAlias} | ${row.provider} | ${row.realModel} | ${row.errorCode ?? "n/a"} | ${(row.errorMessage ?? "").replace(/\|/g, "/").slice(0, 160)} |`)
    ].join("\n"),
    raw: { rows }
  };
}

function gatewayFallbackRoutes(): ToolExecutionResult {
  const rows = db.select().from(modelRoutes).all().map((row) => {
    let fallback: Array<{ provider?: string; model?: string }> = [];
    try {
      fallback = JSON.parse(row.fallbackJson || "[]") as Array<{ provider?: string; model?: string }>;
    } catch {
      fallback = [];
    }
    return {
      alias: row.alias,
      primary: `${row.provider} / ${row.realModel}`,
      fallbackText: fallback.length ? fallback.map((item) => `${item.provider ?? "unknown"} / ${item.model ?? "unknown"}`).join(", ") : "none",
      enabled: row.enabled
    };
  });
  if (!rows.length) return { summary: "No configured fallback routes are available.", raw: { rows } };
  return {
    summary: [
      "| Alias | Primary | Fallbacks | Status |",
      "| ----- | ------- | --------- | ------ |",
      ...rows.map((row) => `| ${row.alias} | ${row.primary} | ${row.fallbackText} | ${row.enabled ? "enabled" : "disabled"} |`)
    ].join("\n"),
    raw: { rows }
  };
}

function gatewayApiKeyOverview(): ToolExecutionResult {
  const keyRows = db.select().from(apiKeys).all();
  const requestRows = db.select().from(requests).all();
  if (!keyRows.length) return { summary: "No API keys are configured.", raw: { rows: [] } };
  const rows = keyRows.map((key) => ({
    name: key.name,
    enabled: key.enabled,
    monthlyLimit: key.monthlyLimit,
    lastUsedAt: key.lastUsedAt,
    requestCount: requestRows.filter((request) => request.apiKeyId === key.id).length
  }));
  return {
    summary: [
      "Safe API key overview. Full key values are not shown.",
      "",
      "| Name | Enabled | Monthly limit | Last used | Requests |",
      "| ---- | ------- | ------------: | --------- | -------: |",
      ...rows.map((row) => `| ${row.name} | ${row.enabled ? "yes" : "no"} | ${row.monthlyLimit ?? "none"} | ${row.lastUsedAt ?? "never"} | ${row.requestCount} |`)
    ].join("\n"),
    raw: { rows }
  };
}

function gatewayLogsSummary(): ToolExecutionResult {
  const rows = db.select().from(requests).all();
  if (!rows.length) return { summary: "No gateway request logs are recorded yet.", raw: { rows } };
  const recent = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  const errors = rows.filter((row) => row.status === "error").length;
  const avgLatency = Math.round(rows.reduce((total, row) => total + row.latencyMs, 0) / rows.length);
  return {
    summary: [
      `Recorded gateway traffic: ${rows.length} requests, ${errors} errors, average latency ${ms(avgLatency)}.`,
      "",
      "| Time | Alias | Provider | Status | Latency |",
      "| ---- | ----- | -------- | ------ | ------: |",
      ...recent.map((row) => `| ${row.createdAt} | ${row.modelAlias} | ${row.provider} | ${row.status} | ${ms(row.latencyMs)} |`)
    ].join("\n"),
    raw: { total: rows.length, errors, avgLatencyMs: avgLatency, recent }
  };
}

async function webSearch(input: z.infer<typeof webSearchInputSchema>): Promise<ToolExecutionResult> {
  const baseUrl = configuredSearxngUrl();
  if (!baseUrl) {
    throw new Error("SearXNG is not configured");
  }
  const maxResults = Math.min(input.max_results ?? env.WEB_SEARCH_MAX_RESULTS, env.WEB_SEARCH_MAX_RESULTS);
  const response = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: input.query, max_results: maxResults }),
    signal: AbortSignal.timeout(env.WEB_SEARCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    answer?: string;
    results?: Array<{ title?: string; url?: string; content?: string; snippet?: string }>;
    response_time?: number;
    request_id?: string;
  };
  const results = (body.results ?? [])
    .filter((result) => result.url)
    .slice(0, maxResults)
    .map((result) => ({
      title: result.title || result.url || "Result",
      url: result.url!,
      snippet: result.content ?? result.snippet
    }));
  const resultSummary = results.length
    ? results.map((result, index) => `${index + 1}. ${result.title}: ${result.snippet ?? result.url}`).join("\n")
    : "No search results found.";
  return {
    summary: [body.answer?.trim(), resultSummary].filter(Boolean).join("\n\n").slice(0, 6000),
    sources: results,
    raw: { query: input.query, count: results.length, responseTime: body.response_time, requestId: body.request_id }
  };
}

async function webExtract(input: z.infer<typeof webExtractInputSchema>): Promise<ToolExecutionResult> {
  const baseUrl = configuredSearxngUrl();
  if (!baseUrl) {
    throw new Error("SearXNG is not configured");
  }

  const response = await fetch(`${baseUrl}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input.url, size: input.size }),
    signal: AbortSignal.timeout(env.WEB_SEARCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`SearXNG extract returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    title?: string;
    url?: string;
    content?: string;
    chars?: number;
    total_chars?: number;
    pages?: unknown;
  };
  const title = body.title?.trim() || input.url;
  const content = body.content?.trim() || "No readable content was extracted.";
  return {
    summary: [`# ${title}`, `Source: ${body.url ?? input.url}`, "", content].join("\n").slice(0, 12000),
    sources: [{ title, url: body.url ?? input.url, snippet: content.slice(0, 500) }],
    raw: { url: body.url ?? input.url, size: input.size, chars: body.chars, totalChars: body.total_chars, pages: body.pages }
  };
}

export function listChatTools(options: ToolOptions = {}): ChatTool[] {
  const gatewayTools: ChatTool<Record<string, unknown>>[] = [
    {
      name: "gateway_model_list",
      description: "List configured gateway model aliases, providers, real models, request counts, latency, errors, fallback counts, and enabled status.",
      schema: emptyInputSchema,
      enabled: true,
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: 2_000,
      executor: async () => gatewayModelList()
    },
    {
      name: "gateway_latency_comparison",
      description: "Compare configured gateway model latency, last request latency, error rate, fallback count, and status.",
      schema: emptyInputSchema,
      enabled: true,
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: 2_000,
      executor: async () => gatewayLatencyComparison()
    },
    {
      name: "gateway_provider_status",
      description: "Show provider configuration status and recorded traffic health for each provider.",
      schema: emptyInputSchema,
      enabled: true,
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: 2_000,
      executor: async () => gatewayProviderStatus()
    },
    {
      name: "gateway_recent_errors",
      description: "Show the latest recorded gateway errors, including alias, provider, model, code, and safe truncated message.",
      schema: emptyInputSchema,
      enabled: true,
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: 2_000,
      executor: async () => gatewayRecentErrors()
    },
    {
      name: "gateway_fallback_routes",
      description: "Show configured gateway primary and fallback routes for model aliases.",
      schema: emptyInputSchema,
      enabled: true,
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: 2_000,
      executor: async () => gatewayFallbackRoutes()
    },
    {
      name: "gateway_api_key_overview",
      description: "Show a safe API key overview without secrets or full key values.",
      schema: emptyInputSchema,
      enabled: true,
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: 2_000,
      executor: async () => gatewayApiKeyOverview()
    },
    {
      name: "gateway_logs_summary",
      description: "Summarize recorded gateway request logs, total traffic, errors, average latency, and recent requests.",
      schema: emptyInputSchema,
      enabled: true,
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: 2_000,
      executor: async () => gatewayLogsSummary()
    }
  ];

  return [
    ...gatewayTools,
    {
      name: "web_search",
      description: "Search the web using the configured SearXNG-compatible backend. Use for current or external information, then call web_extract when a result page needs to be read.",
      schema: webSearchInputSchema,
      enabled: options.webSearchEnabled === true && Boolean(configuredSearxngUrl()),
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: env.WEB_SEARCH_TIMEOUT_MS,
      executor: webSearch
    },
    {
      name: "web_extract",
      description: "Fetch a URL and extract its readable page content as Markdown using the configured SearXNG-compatible backend. Use when the user provides a URL or when a search result needs to be opened.",
      schema: webExtractInputSchema,
      enabled: options.webSearchEnabled === true && Boolean(configuredSearxngUrl()),
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: env.WEB_SEARCH_TIMEOUT_MS,
      executor: webExtract
    }
  ];
}

function zodObjectToJsonSchema(tool: ChatTool) {
  if (tool.name === "web_search") {
    return {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        max_results: { type: "integer", minimum: 1, maximum: 10, description: "Maximum number of results to return" }
      },
      required: ["query"],
      additionalProperties: false
    };
  }
  if (tool.name === "web_extract") {
    return {
      type: "object",
      properties: {
        url: { type: "string", format: "uri", description: "URL to fetch and convert to Markdown" },
        size: { type: "string", enum: ["s", "m", "l"], description: "Extraction size: s for short, m for medium, l for long" }
      },
      required: ["url"],
      additionalProperties: false
    };
  }
  return {
    type: "object",
    properties: {},
    additionalProperties: false
  };
}

export function openAiToolDefinitions(options: ToolOptions = {}) {
  return listChatTools(options)
    .filter((tool) => tool.enabled)
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodObjectToJsonSchema(tool)
      }
    }));
}

export async function executeChatTool(name: string, input: unknown, options: ToolOptions = {}): Promise<ToolExecutionResult> {
  const tool = listChatTools(options).find((candidate) => candidate.name === name);
  if (!tool || !tool.enabled) {
    throw new Error(`Tool '${name}' is not available`);
  }
  const parsed = tool.schema.parse(input);
  const result = await tool.executor(parsed);
  return {
    ...result,
    summary: result.summary.slice(0, 8000)
  };
}
