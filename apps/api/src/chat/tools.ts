import { z } from "zod";
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

const webSearchInputSchema = z.object({
  query: z.string().min(1).max(400)
});

function configuredSearxngUrl(): string | null {
  if (env.WEB_SEARCH_BACKEND !== "searxng" || !env.SEARXNG_URL) return null;
  return env.SEARXNG_URL.replace(/\/$/, "");
}

async function webSearch(input: z.infer<typeof webSearchInputSchema>): Promise<ToolExecutionResult> {
  const baseUrl = configuredSearxngUrl();
  if (!baseUrl) {
    throw new Error("SearXNG is not configured");
  }
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal: AbortSignal.timeout(env.WEB_SEARCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; snippet?: string }>;
  };
  const results = (body.results ?? [])
    .filter((result) => result.url)
    .slice(0, env.WEB_SEARCH_MAX_RESULTS)
    .map((result) => ({
      title: result.title || result.url || "Result",
      url: result.url!,
      snippet: result.content ?? result.snippet
    }));
  return {
    summary: results.length
      ? results.map((result, index) => `${index + 1}. ${result.title}: ${result.snippet ?? result.url}`).join("\n").slice(0, 6000)
      : "No search results found.",
    sources: results,
    raw: { query: input.query, count: results.length }
  };
}

export function listChatTools(): ChatTool[] {
  return [
    {
      name: "web_search",
      description: "Search the web using the configured local SearXNG backend. Use for current or external information.",
      schema: webSearchInputSchema,
      enabled: Boolean(configuredSearxngUrl()),
      riskLevel: "low",
      requiresConfirmation: false,
      timeoutMs: env.WEB_SEARCH_TIMEOUT_MS,
      executor: webSearch
    }
  ];
}

export function openAiToolDefinitions() {
  return listChatTools()
    .filter((tool) => tool.enabled)
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" }
          },
          required: ["query"],
          additionalProperties: false
        }
      }
    }));
}

export async function executeChatTool(name: string, input: unknown): Promise<ToolExecutionResult> {
  const tool = listChatTools().find((candidate) => candidate.name === name);
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
