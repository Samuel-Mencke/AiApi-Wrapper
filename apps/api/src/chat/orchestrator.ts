import { estimateCostUsd } from "@ai-gateway/core/pricing";
import type { InternalMessage } from "@ai-gateway/core";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { chatMessages, chatRuns, chatSteps, chatThreads } from "../db/schema.js";
import { env } from "../env.js";
import { executeStreamWithFallback } from "../router/fallback.js";
import { resolveModel } from "../router/resolve-model.js";
import { executeChatTool, openAiToolDefinitions } from "./tools.js";
import { generateFunctionPlotPoints } from "./function-plot.js";
import { parseRichBlocksFromText, richBlocksSchema, type RichBlocks } from "./rich-blocks.js";
import { CHAT_API_KEY_ID, ensureInternalChatApiKey } from "./internal-api-key.js";

export type ChatRunEvent =
  | { type: "run"; run: unknown }
  | { type: "message"; message: unknown }
  | { type: "step"; step: unknown }
  | { type: "reasoning_delta"; content: string }
  | { type: "delta"; content: string }
  | { type: "tool_call"; toolCall: unknown }
  | { type: "tool_result"; toolCallId?: string; toolName: string; result: unknown }
  | { type: "rich_block"; block: unknown }
  | { type: "done"; message: unknown; run: unknown }
  | { type: "error"; error: string };

const assistantSystemPrompt = `Du bist ein hochfähiger, allgemeiner KI-Assistent — wie ChatGPT, nur besser. Du hilfst bei allem: Fragen beantworten, Code schreiben, Texte verfassen, Mathematik, Brainstorming, Recherchen, Erklärungen. Du bist nicht auf ein bestimmtes Gebiet spezialisiert, sondern ein universeller Begleiter für alle Alltag- und Entwickleraufgaben.

## Wen du hilfst
Du antwortest **Samuel Mencke** — 15 Jahre alt, Entwickler aus Deutschland (9. Klasse Realschule mit gymnasialer Oberstufe, Mathe+Englisch Leistungskurs).
- **Sprache:** Immer auf Deutsch antworten, außer Samuel schreibt Englisch.
- **Interessen:** Programmieren (TS/Python/C++), ML/AI, Web-Dev, Minecraft-Tools, autonome Agenten, Musik (Piano, Ableton).
- ** Stil:** Locker, direkt, keine Floskeln, keine Emojis. Kurze präzise Antworten. Hasst halluzinierte oder nutzlose Antworten.

## Deine Stärken
1. ** Universell** — Du kannst alles: Programmieren, Schreiben, Erklären, Rechnen, Analysieren, Brainstormen. Keine Frage ist zu trivial oder zu komplex.
2. ** Deep Reasoning** — Denke komplexe Probleme Schritt für Schritt durch. Break down hard questions. Zeige deinen Gedankengang kurz wenn es hilft.
3. ** Web-Suche** — Du hast Live-Web-Zugriff. Suche nach aktuellen Informationen, extrahiere Webseiten, nenne Quellen. Nutze das proaktiv bei allem, das aktuelle Infos braucht.
4. ** Code-Expertise** — Production-quality Code. Sprache angeben, Type Hints, Edge Cases behandeln. Erkläre Architekturentscheidungen kurz.
5. ** Kreativ** — Ideen generieren, Texte verfassen, Brainstorming. Sei kreativ und originell, nicht generisch.
6. ** Ehrlich** — Wenn du etwas nicht weißt, sag es. Wenn etwas fehlschlägt, melde es wahrheitsgemäß. Erfinde niemals Fakten, Code-APIs oder technische Details.

## Werkzeuge (nutze sie nur wenn wirklich hilfreich)
- **web_search** — Live-Websuche über SearXNG
- **web_extract** — Liest den Inhalt einer URL als Markdown
- Du hast auch einige Admin-Tools für das Gateway Dashboard verfügbar — nutze sie nur wenn Samuel explizit nach Gateway-Metriken fragt.

## Formatierung
- Antworte in Markdown mit sauberer Struktur (Header, Listen, **fett** für Hervorhebungen)
- Code-Blöcke: immer Sprache angeben, Type Hints
- Tabellen für Vergleiche, kurze Absätze (2-3 Sätze)
- Deutsch standardmäßig, Englisch wenn Samuel wechselt

## Rich Content
Für erweiterte Darstellung kannst du einen fenced \`\`\`rich_blocks JSON-Block anhängen. Typen: markdown, code, table, chart (bar/line/pie/scatter), function_plot, math.
Nutze das nur wenn es wirklich hilft — nicht für einfache Antworten erzwingen.

## Sicherheit
- Niemals API-Keys, Secrets oder Tokens preisgeben
- Kein rohes HTML, iframes oder externe Scripts als darstellbaren Content
- Sichtbares Denken kommt vom Provider-Stream — erfinde kein hidden reasoning`;

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

function textForContext(message: typeof chatMessages.$inferSelect) {
  const metadata = parseJson(message.metadataJson, {}) as { compactSummary?: string };
  return metadata.compactSummary || message.contentText;
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
      .map((message) => {
        const metadata = parseJson(message.metadataJson, {}) as { reasoningContent?: string; thinkingContent?: string };
        return {
          role: message.role as InternalMessage["role"],
          content: textForContext(message),
          reasoningContent: message.role === "assistant" ? metadata.reasoningContent : undefined,
          thinkingContent: message.role === "assistant" ? metadata.thinkingContent : undefined
        };
      })
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

type StreamToolCall = {
  id?: string;
  type?: string;
  function: {
    name: string;
    arguments: string;
  };
};

type ModelStreamResult = {
  content: string;
  reasoningText: string;
  thinkingText: string;
  toolCalls: StreamToolCall[];
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  finishReason: string | null;
};

function mergeUsage(target: ModelStreamResult["usage"], usage: unknown) {
  if (!usage || typeof usage !== "object") return;
  const value = usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  target.inputTokens = value.prompt_tokens ?? target.inputTokens;
  target.outputTokens = value.completion_tokens ?? target.outputTokens;
  target.totalTokens = value.total_tokens ?? target.totalTokens;
}

function appendToolCallFragment(map: Map<number, StreamToolCall>, fragment: any) {
  const index = typeof fragment.index === "number" ? fragment.index : map.size;
  const current = map.get(index) ?? { id: fragment.id, type: fragment.type, function: { name: "", arguments: "" } };
  if (typeof fragment.id === "string") current.id = fragment.id;
  if (typeof fragment.type === "string") current.type = fragment.type;
  if (fragment.function && typeof fragment.function === "object") {
    if (typeof fragment.function.name === "string") current.function.name += fragment.function.name;
    if (typeof fragment.function.arguments === "string") current.function.arguments += fragment.function.arguments;
  }
  map.set(index, current);
}

async function readModelStream(
  stream: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<ModelStreamResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const toolCallMap = new Map<number, StreamToolCall>();
  const result: ModelStreamResult = {
    content: "",
    reasoningText: "",
    thinkingText: "",
    toolCalls: [],
    usage: {},
    finishReason: null
  };
  let buffer = "";

  function processPayload(payload: string) {
    if (!payload || payload === "[DONE]") return;
    let parsed: any;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }

    mergeUsage(result.usage, parsed.usage);
    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
    if (!choice) return;
    mergeUsage(result.usage, choice.usage);
    if (choice.finish_reason) result.finishReason = choice.finish_reason;

    const delta = choice.delta ?? choice.message ?? {};
    const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
    const thinking = typeof delta.thinking_content === "string" ? delta.thinking_content : "";
    const content = typeof delta.content === "string" ? delta.content : "";

    if (reasoning) {
      result.reasoningText += reasoning;
      emitSse(controller, { type: "reasoning_delta", content: reasoning });
    }
    if (thinking) {
      result.thinkingText += thinking;
      emitSse(controller, { type: "reasoning_delta", content: thinking });
    }
    if (content) {
      result.content += content;
      emitSse(controller, { type: "delta", content });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const fragment of delta.tool_calls) {
        appendToolCallFragment(toolCallMap, fragment);
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const dataLines = event.split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6).trim());
      for (const payload of dataLines) {
        processPayload(payload);
      }
    }
  }
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (line.startsWith("data: ")) processPayload(line.slice(6).trim());
    }
  }

  result.toolCalls = [...toolCallMap.values()].filter((call) => call.function.name);
  return result;
}

function shouldUseZaiThinking(route: ReturnType<typeof resolveModel>) {
  return route.attempts.length > 0 && route.attempts.every((attempt) => attempt.provider === "z-ai" || attempt.model.toLowerCase().startsWith("glm"));
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

export function createChatRunStream(input: { threadId?: string; content: string; modelAlias: string; webSearch?: boolean }) {
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

        const context = buildContext(threadId);
        if (context.compacted) {
          const compact = createStep(runId, "compact", "Context compacted", { maxMessages: env.CHAT_CONTEXT_MAX_MESSAGES }, "completed");
          emitSse(controller, { type: "step", step: serializeStep(compact) });
        }

        let messages: InternalMessage[] = context.messages;
        const toolOptions = { webSearchEnabled: input.webSearch === true };
        const tools = openAiToolDefinitions(toolOptions);
        let finalText = "";
        let finalReasoningText = "";
        let finalThinkingText = "";
        let finalProvider = target?.provider ?? null;
        let finalModel = target?.model ?? null;
        let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};

        for (let stepIndex = 0; stepIndex < env.CHAT_AGENT_MAX_STEPS; stepIndex += 1) {
          const modelStep = createStep(runId, "model", "Provider call", { stepIndex, modelAlias: input.modelAlias, route: route.attempts });
          emitSse(controller, { type: "step", step: serializeStep(modelStep) });
          const extraBody: Record<string, unknown> = {};
          if (tools.length) extraBody.tool_choice = "auto";
          if (shouldUseZaiThinking(route)) {
            extraBody.thinking = { type: "enabled", clear_thinking: false };
          }
          const result = await executeStreamWithFallback(
            {
              modelAlias: input.modelAlias,
              messages,
              maxTokens: 8192,
              stream: true,
              streamOptions: { include_usage: true },
              tools: tools.length ? tools : undefined,
              extraBody: Object.keys(extraBody).length ? extraBody : undefined
            },
            CHAT_API_KEY_ID
          );
          finalProvider = result.provider;
          finalModel = result.realModel;
          const streamed = await readModelStream(result.stream, controller);
          usage = {
            inputTokens: streamed.usage.inputTokens ?? usage.inputTokens,
            outputTokens: streamed.usage.outputTokens ?? usage.outputTokens,
            totalTokens: streamed.usage.totalTokens ?? usage.totalTokens
          };
          completeStep(modelStep.id, {
            provider: result.provider,
            realModel: result.realModel,
            finishReason: streamed.finishReason,
            contentChars: streamed.content.length,
            reasoningChars: streamed.reasoningText.length + streamed.thinkingText.length
          });
          emitSse(controller, { type: "step", step: serializeStep(db.select().from(chatSteps).where(eq(chatSteps.id, modelStep.id)).get()!) });

          if (streamed.toolCalls.length && tools.length) {
            messages = [
              ...messages,
              {
                role: "assistant",
                content: streamed.content || null,
                toolCalls: streamed.toolCalls,
                reasoningContent: streamed.reasoningText || undefined,
                thinkingContent: streamed.thinkingText || undefined
              }
            ];
            for (const call of streamed.toolCalls) {
              let args: unknown = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch {
                args = {};
              }
              emitSse(controller, { type: "tool_call", toolCall: call });
              const toolStep = createStep(runId, "tool", call.function.name, args);
              emitSse(controller, { type: "step", step: serializeStep(toolStep) });
              try {
                const output = await executeChatTool(call.function.name, args, toolOptions);
                const completed = completeStep(toolStep.id, output);
                emitSse(controller, { type: "step", step: serializeStep(completed) });
                emitSse(controller, { type: "tool_result", toolCallId: call.id, toolName: call.function.name, result: output });
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
                emitSse(controller, { type: "tool_result", toolCallId: call.id, toolName: call.function.name, result: { error: error instanceof Error ? error.message : "Tool failed" } });
                messages = [...messages, { role: "tool", toolCallId: call.id, content: JSON.stringify({ error: "Tool failed" }) }];
              }
            }
            continue;
          }
          finalText = streamed.content;
          finalReasoningText = streamed.reasoningText;
          finalThinkingText = streamed.thinkingText;
          break;
        }

        if (!finalText) {
          finalText = "I reached the step limit before producing a final answer.";
          emitSse(controller, { type: "delta", content: finalText });
        }

        const parsed = parseRichBlocksFromText(finalText);
        const blocks = normalizeBlocks(richBlocksSchema.parse(parsed.blocks));
        for (const block of blocks.blocks) {
          if (block.type !== "markdown") {
            emitSse(controller, { type: "rich_block", block });
          }
        }
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
            reasoningText: finalReasoningText || finalThinkingText || undefined,
            reasoningContent: finalReasoningText || undefined,
            thinkingContent: finalThinkingText || undefined,
            inputTokens: usage.inputTokens ?? null,
            outputTokens: usage.outputTokens ?? null,
            totalTokens: usage.totalTokens ?? null
          }),
          createdAt: now()
        };
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
