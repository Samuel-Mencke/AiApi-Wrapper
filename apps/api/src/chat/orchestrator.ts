import { estimateCostUsd } from "@ai-gateway/core/pricing";
import type { InternalMessage } from "@ai-gateway/core";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { apiKeys, chatMessages, chatRuns, chatSteps, chatThreads, modelRoutes, providers, requests } from "../db/schema.js";
import { env } from "../env.js";
import { executeWithFallback } from "../router/fallback.js";
import { resolveModel } from "../router/resolve-model.js";
import { executeChatTool, openAiToolDefinitions } from "./tools.js";
import { generateFunctionPlotPoints } from "./function-plot.js";
import { markdownOnly, parseRichBlocksFromText, richBlocksSchema, type RichBlocks } from "./rich-blocks.js";
import { CHAT_API_KEY_ID, ensureInternalChatApiKey } from "./internal-api-key.js";

export type ChatRunEvent =
  | { type: "run"; run: unknown }
  | { type: "message"; message: unknown }
  | { type: "step"; step: unknown }
  | { type: "delta"; content: string }
  | { type: "done"; message: unknown; run: unknown }
  | { type: "error"; error: string };

const assistantSystemPrompt = `You are the built-in assistant for this AI gateway admin UI. Prefer live gateway data over generic AI knowledge.
When asked about models, latency, providers, logs, errors, API keys, fallback routes, or configuration, use available gateway context/tools.
Never invent configured models, latency values, provider names, charts, or metrics. If live data is unavailable, say so clearly.
Do not output unsupported rich content blocks. Use Markdown tables for structured comparisons. Do not output rich_blocks fences.
Do not expose secrets or full API keys. Do not claim thinking, reasoning, or planning unless a provider actually returned a reasoning summary.
Reply normally in Markdown. Do not output executable HTML, CSS, JavaScript, iframes, forms, SVG event handlers, or external resources.
If the user asks for HTML, show it as a fenced code block.`;

const toolCallSchema = z.object({
  id: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string().default("{}")
  })
});

function now() {
  return new Date().toISOString();
}

function parseJson(value: string | null | undefined, fallback: unknown) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeMessage(row: typeof chatMessages.$inferSelect) {
  return {
    ...row,
    contentBlocks: parseJson(row.contentBlocksJson, { blocks: [] }),
    metadata: parseJson(row.metadataJson, {})
  };
}

function serializeRun(row: typeof chatRuns.$inferSelect) {
  return row;
}

function serializeStep(row: typeof chatSteps.$inferSelect) {
  return {
    ...row,
    input: parseJson(row.inputJson, {}),
    output: parseJson(row.outputJson, {})
  };
}

function titleFrom(content: string) {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.slice(0, 64) || "New chat";
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

function detectGatewayIntent(content: string):
  | "latency_comparison"
  | "model_list"
  | "provider_status"
  | "recent_errors"
  | "fallback_routes"
  | "api_key_overview"
  | "logs_summary"
  | null {
  const text = content.toLowerCase();
  if (/(compare|vergleich|vergleiche|fastest|schnell|latency|latenz|slowest|langsam)/.test(text) && /(model|modell|provider|route|latency|latenz)/.test(text)) {
    return "latency_comparison";
  }
  if (/(model list|models|modelle|configured models|modellliste)/.test(text)) return "model_list";
  if (/(provider status|providers|provider health|anbieter)/.test(text)) return "provider_status";
  if (/(recent errors|api errors|fehler|errors|error rate)/.test(text)) return "recent_errors";
  if (/(fallback|fallback routes|route)/.test(text)) return "fallback_routes";
  if (/(api key|api keys|keys|schlussel|schluessel)/.test(text)) return "api_key_overview";
  if (/(logs|log summary|requests|traffic|api behavior)/.test(text)) return "logs_summary";
  return null;
}

function modelMetrics() {
  const routeRows = db.select().from(modelRoutes).all();
  const requestRows = db.select().from(requests).all();
  return routeRows.map((route) => {
    const matching = requestRows.filter((request) => request.modelAlias === route.alias);
    const errors = matching.filter((request) => request.status === "error").length;
    const latest = matching.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
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

function gatewayLatencyComparison() {
  const rows = modelMetrics().sort((a, b) => (a.avgLatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.avgLatencyMs ?? Number.MAX_SAFE_INTEGER));
  if (!rows.length) return "I don't have access to configured gateway models yet.";
  const table = [
    "| Alias | Provider | Real model | Avg latency | Last request | Error rate | Fallbacks | Status |",
    "| ----- | -------- | ---------- | ----------: | -----------: | ---------: | --------: | ------ |",
    ...rows.map((row) => `| ${row.alias} | ${row.provider} | ${row.realModel} | ${ms(row.avgLatencyMs)} | ${ms(row.lastLatencyMs)} | ${percent(row.errorRate)} | ${row.fallbackCount} | ${row.status} |`)
  ].join("\n");
  const withLatency = rows.filter((row) => row.avgLatencyMs !== null);
  const fastest = withLatency[0];
  const slowest = withLatency.at(-1);
  const elevatedErrors = rows.filter((row) => (row.errorRate ?? 0) > 0.05);
  return [
    "Here are your configured gateway models sorted by average latency:",
    "",
    table,
    "",
    fastest ? `Fastest configured model with traffic: **${fastest.alias}** (${fastest.provider} / ${fastest.realModel}) at ${ms(fastest.avgLatencyMs)} average latency.` : "No request latency data has been recorded yet.",
    slowest && slowest !== fastest ? `Slowest configured model with traffic: **${slowest.alias}** at ${ms(slowest.avgLatencyMs)} average latency.` : "",
    elevatedErrors.length ? `Models with elevated error rate: ${elevatedErrors.map((row) => `**${row.alias}** (${percent(row.errorRate)})`).join(", ")}.` : "No configured model currently shows an elevated error rate in recorded gateway traffic.",
    "",
    "Recommendation: prefer the fastest enabled model with a low error rate for latency-sensitive gateway traffic; keep fallbacks on slower or less reliable routes."
  ].filter(Boolean).join("\n");
}

function gatewayModelList() {
  const rows = modelMetrics();
  if (!rows.length) return "I don't have access to configured gateway models yet.";
  return [
    "Here are your configured gateway models:",
    "",
    "| Alias | Provider | Real model | Status | Fallbacks | Requests | Avg latency | Error rate |",
    "| ----- | -------- | ---------- | ------ | --------: | -------: | ----------: | ---------: |",
    ...rows.map((row) => `| ${row.alias} | ${row.provider} | ${row.realModel} | ${row.status} | ${row.fallbackCount} | ${row.requestCount} | ${ms(row.avgLatencyMs)} | ${percent(row.errorRate)} |`)
  ].join("\n");
}

function gatewayProviderStatus() {
  const providerRows = db.select().from(providers).all();
  const requestRows = db.select().from(requests).all();
  if (!providerRows.length) return "I don't have access to configured providers yet.";
  return [
    "Here is the current gateway provider status from your configuration and recorded traffic:",
    "",
    "| Provider | Type | Enabled | Requests | Avg latency | Error rate |",
    "| -------- | ---- | ------- | -------: | ----------: | ---------: |",
    ...providerRows.map((provider) => {
      const matching = requestRows.filter((request) => request.provider === provider.name);
      const errors = matching.filter((request) => request.status === "error").length;
      const avgLatency = matching.length ? Math.round(matching.reduce((total, request) => total + request.latencyMs, 0) / matching.length) : null;
      return `| ${provider.name} | ${provider.type} | ${provider.enabled ? "yes" : "no"} | ${matching.length} | ${ms(avgLatency)} | ${percent(matching.length ? errors / matching.length : null)} |`;
    })
  ].join("\n");
}

function gatewayRecentErrors() {
  const recent = db.select().from(requests).all()
    .filter((request) => request.status === "error")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  if (!recent.length) return "No recent gateway errors are recorded.";
  return [
    "Here are the most recent gateway errors:",
    "",
    "| Time | Alias | Provider | Real model | Code | Message |",
    "| ---- | ----- | -------- | ---------- | ---- | ------- |",
    ...recent.map((row) => `| ${row.createdAt} | ${row.modelAlias} | ${row.provider} | ${row.realModel} | ${row.errorCode ?? "n/a"} | ${(row.errorMessage ?? "").replace(/\|/g, "/").slice(0, 160)} |`)
  ].join("\n");
}

function gatewayFallbackRoutes() {
  const rows = db.select().from(modelRoutes).all();
  if (!rows.length) return "I don't have access to configured fallback routes yet.";
  return [
    "Here are your configured gateway fallback routes:",
    "",
    "| Alias | Primary | Fallbacks | Status |",
    "| ----- | ------- | --------- | ------ |",
    ...rows.map((row) => {
      let fallback: Array<{ provider?: string; model?: string }> = [];
      try {
        fallback = JSON.parse(row.fallbackJson || "[]") as Array<{ provider?: string; model?: string }>;
      } catch {
        fallback = [];
      }
      const fallbackText = fallback.length ? fallback.map((item) => `${item.provider ?? "unknown"} / ${item.model ?? "unknown"}`).join(", ") : "none";
      return `| ${row.alias} | ${row.provider} / ${row.realModel} | ${fallbackText} | ${row.enabled ? "enabled" : "disabled"} |`;
    })
  ].join("\n");
}

function gatewayApiKeyOverview() {
  const keyRows = db.select().from(apiKeys).all();
  const requestRows = db.select().from(requests).all();
  if (!keyRows.length) return "No API keys are configured.";
  return [
    "Here is a safe API key overview. Full key values are not shown.",
    "",
    "| Name | Enabled | Monthly limit | Last used | Requests |",
    "| ---- | ------- | ------------: | --------- | -------: |",
    ...keyRows.map((key) => `| ${key.name} | ${key.enabled ? "yes" : "no"} | ${key.monthlyLimit ?? "none"} | ${key.lastUsedAt ?? "never"} | ${requestRows.filter((request) => request.apiKeyId === key.id).length} |`)
  ].join("\n");
}

function gatewayLogsSummary() {
  const rows = db.select().from(requests).all();
  if (!rows.length) return "No gateway request logs are recorded yet.";
  const recent = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  const errors = rows.filter((row) => row.status === "error").length;
  const avgLatency = Math.round(rows.reduce((total, row) => total + row.latencyMs, 0) / rows.length);
  return [
    `Recorded gateway traffic: **${rows.length} requests**, **${errors} errors**, average latency **${ms(avgLatency)}**.`,
    "",
    "| Time | Alias | Provider | Status | Latency |",
    "| ---- | ----- | -------- | ------ | ------: |",
    ...recent.map((row) => `| ${row.createdAt} | ${row.modelAlias} | ${row.provider} | ${row.status} | ${ms(row.latencyMs)} |`)
  ].join("\n");
}

function answerGatewayIntent(intent: NonNullable<ReturnType<typeof detectGatewayIntent>>) {
  if (intent === "latency_comparison") return gatewayLatencyComparison();
  if (intent === "model_list") return gatewayModelList();
  if (intent === "provider_status") return gatewayProviderStatus();
  if (intent === "recent_errors") return gatewayRecentErrors();
  if (intent === "fallback_routes") return gatewayFallbackRoutes();
  if (intent === "api_key_overview") return gatewayApiKeyOverview();
  if (intent === "logs_summary") return gatewayLogsSummary();
  return "I don't have access to live gateway metrics yet.";
}

function textForContext(message: typeof chatMessages.$inferSelect) {
  const metadata = parseJson(message.metadataJson, {}) as { compactSummary?: string; reasoningText?: string };
  const content = metadata.compactSummary || message.contentText;
  if (message.role !== "assistant" || !metadata.reasoningText) {
    return content;
  }
  return `Previous visible reasoning for this assistant response:\n${metadata.reasoningText}\n\nAssistant response:\n${content}`;
}

function rawAssistantMessage(raw: unknown): { content: string; toolCalls: Array<z.infer<typeof toolCallSchema>> } {
  const choice = (raw as any)?.choices?.[0];
  const message = choice?.message ?? {};
  const content = typeof message.content === "string" ? message.content : "";
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call: unknown) => toolCallSchema.safeParse(call)).filter((result: any) => result.success).map((result: any) => result.data)
    : [];
  return { content, toolCalls };
}

function normalizeBlocks(blocks: RichBlocks): RichBlocks {
  return {
    blocks: blocks.blocks.map((block) => {
      if (block.type !== "function_plot") return block;
      try {
        return {
          ...block,
          points: generateFunctionPlotPoints(block.expression, block.xMin, block.xMax, block.sampleCount)
        };
      } catch (error) {
        return {
          type: "error" as const,
          message: error instanceof Error ? error.message : "Invalid function plot",
          rawJson: block
        };
      }
    })
  };
}

function buildContext(threadId: string): { messages: InternalMessage[]; compacted: boolean } {
  const rows = db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).all();
  const ordered = rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const compacted = ordered.length > env.CHAT_CONTEXT_MAX_MESSAGES;
  const kept = ordered.slice(-env.CHAT_CONTEXT_MAX_MESSAGES);
  const messages: InternalMessage[] = [
    { role: "system", content: assistantSystemPrompt },
    ...kept
      .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "tool")
      .map((message) => ({
        role: message.role as InternalMessage["role"],
        content: textForContext(message)
      }))
  ];
  return { messages, compacted };
}

function getActiveThread(threadId: string) {
  const thread = db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).get();
  if (!thread || thread.archivedAt) {
    throw new Error("Chat thread not found or archived");
  }
  return thread;
}

function createStep(runId: string, type: "model" | "tool" | "compact" | "error" | "status", name: string, input: unknown, status = "running") {
  const row = {
    id: nanoid(),
    runId,
    messageId: null,
    type,
    name,
    inputJson: JSON.stringify(input ?? {}),
    outputJson: "{}",
    startedAt: now(),
    completedAt: null,
    latencyMs: null,
    status
  };
  db.insert(chatSteps).values(row).run();
  return row;
}

function completeStep(id: string, output: unknown, status = "completed") {
  const step = db.select().from(chatSteps).where(eq(chatSteps.id, id)).get();
  const completedAt = now();
  const latencyMs = step ? Date.parse(completedAt) - Date.parse(step.startedAt) : null;
  db.update(chatSteps)
    .set({ outputJson: JSON.stringify(output ?? {}), completedAt, latencyMs, status })
    .where(eq(chatSteps.id, id))
    .run();
  return db.select().from(chatSteps).where(eq(chatSteps.id, id)).get()!;
}

function emitSse(controller: ReadableStreamDefaultController<Uint8Array>, event: ChatRunEvent) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
}

async function emitText(controller: ReadableStreamDefaultController<Uint8Array>, content: string) {
  const parts = content.split(/(\s+)/).filter(Boolean);
  for (const part of parts) {
    emitSse(controller, { type: "delta", content: part });
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}

export function getThreadPayload(threadId: string) {
  const thread = db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).get();
  if (!thread || thread.archivedAt) return null;
  const messages = db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(serializeMessage);
  const runs = db.select().from(chatRuns).where(eq(chatRuns.threadId, threadId)).all()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(serializeRun);
  const steps = db.select().from(chatSteps).all()
    .filter((step) => runs.some((run) => run.id === step.runId))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(serializeStep);
  return { thread, messages, runs, steps };
}

export function createChatRunStream(input: { threadId?: string; content: string; modelAlias: string }) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let runId = "";
      try {
        ensureInternalChatApiKey();
        const createdAt = now();
        const threadId = input.threadId ?? nanoid();
        if (input.threadId) {
          getActiveThread(input.threadId);
        } else {
          db.insert(chatThreads).values({
            id: threadId,
            userId: null,
            adminSessionId: "admin",
            title: titleFrom(input.content),
            createdAt,
            updatedAt: createdAt,
            archivedAt: null
          }).run();
        }

        const userMessage = {
          id: nanoid(),
          threadId,
          role: "user",
          contentText: input.content,
          contentBlocksJson: JSON.stringify({ blocks: [{ type: "markdown", content: input.content }] }),
          modelAlias: null,
          provider: null,
          realModel: null,
          metadataJson: "{}",
          createdAt
        };
        db.insert(chatMessages).values(userMessage).run();
        db.update(chatThreads).set({ updatedAt: createdAt }).where(eq(chatThreads.id, threadId)).run();
        emitSse(controller, { type: "message", message: serializeMessage(userMessage) });

        const route = resolveModel(input.modelAlias);
        const target = route.attempts[0];
        runId = nanoid();
        const run = {
          id: runId,
          threadId,
          status: "running",
          modelAlias: input.modelAlias,
          provider: target?.provider ?? null,
          realModel: target?.model ?? null,
          startedAt: now(),
          completedAt: null,
          latencyMs: null,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          estimatedCost: null,
          error: null
        };
        db.insert(chatRuns).values(run).run();
        emitSse(controller, { type: "run", run });

        const gatewayIntent = detectGatewayIntent(input.content);
        if (gatewayIntent) {
          const contextStep = createStep(runId, "tool", "Gateway data", { intent: gatewayIntent }, "running");
          emitSse(controller, { type: "step", step: serializeStep(contextStep) });
          const finalText = answerGatewayIntent(gatewayIntent);
          const completedStep = completeStep(contextStep.id, { source: "local gateway admin database", intent: gatewayIntent });
          emitSse(controller, { type: "step", step: serializeStep(completedStep) });

          const finalMessage = {
            id: nanoid(),
            threadId,
            role: "assistant",
            contentText: finalText,
            contentBlocksJson: JSON.stringify(markdownOnly(finalText)),
            modelAlias: input.modelAlias,
            provider: target?.provider ?? null,
            realModel: target?.model ?? null,
            metadataJson: JSON.stringify({
              runId,
              deterministicGatewayIntent: gatewayIntent,
              inputTokens: null,
              outputTokens: null,
              totalTokens: null
            }),
            createdAt: now()
          };
          await emitText(controller, finalText);
          db.insert(chatMessages).values(finalMessage).run();
          const completedAt = now();
          const latencyMs = Date.parse(completedAt) - Date.parse(run.startedAt);
          db.update(chatRuns)
            .set({
              status: "completed",
              completedAt,
              latencyMs,
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              estimatedCost: null
            })
            .where(eq(chatRuns.id, runId))
            .run();
          db.update(chatThreads).set({ updatedAt: completedAt }).where(eq(chatThreads.id, threadId)).run();
          const savedRun = db.select().from(chatRuns).where(eq(chatRuns.id, runId)).get()!;
          emitSse(controller, { type: "done", message: serializeMessage(finalMessage), run: savedRun });
          controller.close();
          return;
        }

        const context = buildContext(threadId);
        if (context.compacted) {
          const compact = createStep(runId, "compact", "Context compacted", { maxMessages: env.CHAT_CONTEXT_MAX_MESSAGES }, "completed");
          emitSse(controller, { type: "step", step: serializeStep(compact) });
        }

        let messages: InternalMessage[] = context.messages;
        const tools = openAiToolDefinitions();
        let finalText = "";
        let finalProvider = target?.provider ?? null;
        let finalModel = target?.model ?? null;
        let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};

        for (let stepIndex = 0; stepIndex < env.CHAT_AGENT_MAX_STEPS; stepIndex += 1) {
          const modelStep = createStep(runId, "model", "Provider call", { stepIndex, modelAlias: input.modelAlias, route: route.attempts });
          emitSse(controller, { type: "step", step: serializeStep(modelStep) });
          const result = await executeWithFallback(
            {
              modelAlias: input.modelAlias,
              messages,
              maxTokens: 4000,
              stream: false,
              tools: tools.length ? tools : undefined,
              extraBody: tools.length ? { tool_choice: "auto" } : undefined
            },
            CHAT_API_KEY_ID
          );
          completeStep(modelStep.id, { provider: result.provider, realModel: result.realModel, latencyMs: result.latencyMs });
          emitSse(controller, { type: "step", step: serializeStep(db.select().from(chatSteps).where(eq(chatSteps.id, modelStep.id)).get()!) });

          finalProvider = result.provider;
          finalModel = result.realModel;
          usage = result.response.usage ?? usage;
          const { content, toolCalls } = rawAssistantMessage(result.response.raw);
          if (toolCalls.length && tools.length) {
            messages = [
              ...messages,
              { role: "assistant", content: content || null, toolCalls }
            ];
            for (const call of toolCalls) {
              let args: unknown = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch {
                args = {};
              }
              const toolStep = createStep(runId, "tool", call.function.name, args);
              emitSse(controller, { type: "step", step: serializeStep(toolStep) });
              try {
                const output = await executeChatTool(call.function.name, args);
                const completed = completeStep(toolStep.id, output);
                emitSse(controller, { type: "step", step: serializeStep(completed) });
                messages = [
                  ...messages,
                  {
                    role: "tool",
                    toolCallId: call.id,
                    content: JSON.stringify({ summary: output.summary, sources: output.sources ?? [] })
                  }
                ];
              } catch (error) {
                const completed = completeStep(toolStep.id, { error: error instanceof Error ? error.message : "Tool failed" }, "failed");
                emitSse(controller, { type: "step", step: serializeStep(completed) });
                messages = [...messages, { role: "tool", toolCallId: call.id, content: JSON.stringify({ error: "Tool failed" }) }];
              }
            }
            continue;
          }
          finalText = content || String(result.response.content ?? "");
          break;
        }

        if (!finalText) {
          finalText = "I reached the step limit before producing a final answer.";
        }

        const parsed = parseRichBlocksFromText(finalText);
        const blocks = normalizeBlocks(richBlocksSchema.parse(parsed.blocks));
        const finalMessage = {
          id: nanoid(),
          threadId,
          role: "assistant",
          contentText: parsed.text,
          contentBlocksJson: JSON.stringify(blocks),
          modelAlias: input.modelAlias,
          provider: finalProvider,
          realModel: finalModel,
          metadataJson: JSON.stringify({
            runId,
            inputTokens: usage.inputTokens ?? null,
            outputTokens: usage.outputTokens ?? null,
            totalTokens: usage.totalTokens ?? null
          }),
          createdAt: now()
        };
        await emitText(controller, parsed.text);
        db.insert(chatMessages).values(finalMessage).run();
        const completedAt = now();
        const latencyMs = Date.parse(completedAt) - Date.parse(run.startedAt);
        const estimatedCost = finalModel ? estimateCostUsd(finalModel, usage.inputTokens, usage.outputTokens) : null;
        db.update(chatRuns)
          .set({
            status: "completed",
            provider: finalProvider,
            realModel: finalModel,
            completedAt,
            latencyMs,
            inputTokens: usage.inputTokens ?? null,
            outputTokens: usage.outputTokens ?? null,
            totalTokens: usage.totalTokens ?? null,
            estimatedCost
          })
          .where(eq(chatRuns.id, runId))
          .run();
        db.update(chatThreads).set({ updatedAt: completedAt }).where(eq(chatThreads.id, threadId)).run();
        const savedRun = db.select().from(chatRuns).where(eq(chatRuns.id, runId)).get()!;
        emitSse(controller, { type: "done", message: serializeMessage(finalMessage), run: savedRun });
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Chat run failed";
        if (runId) {
          db.update(chatRuns).set({ status: "failed", completedAt: now(), error: message }).where(eq(chatRuns.id, runId)).run();
          const step = createStep(runId, "error", "Run failed", {}, "failed");
          const completed = completeStep(step.id, { error: message }, "failed");
          emitSse(controller, { type: "step", step: serializeStep(completed) });
        }
        emitSse(controller, { type: "error", error: message });
        controller.close();
      }
    }
  });
}
