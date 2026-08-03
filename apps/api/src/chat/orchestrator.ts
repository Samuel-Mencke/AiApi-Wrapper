import { estimateCostUsd } from "@model-console/core/pricing";
import type { InternalMessage } from "@model-console/core";
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
import { applyUncensoredTransform, buildRetryMessages, detectRefusal, isUncensoredAlias, uncensoredInstructions } from "../middleware/uncensored.js";

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
Für erweiterte Darstellung kannst du einen fenced \`\`\`rich_blocks JSON-Block anhängen. Typen: markdown, code, html, table, chart (bar/line/pie/scatter), function_plot, math.
Nutze das nur wenn es wirklich hilft — nicht für einfache Antworten erzwingen.

## HTML-Generierung (interaktive UI)
Du kannst **komplette HTML-Blöcke** generieren — mit inline CSS, SVG, MathML und JavaScript. Diese werden live in der Chat-UI gerendert (in einer sicheren iframe-Sandbox). Verwende dafür einen \`html\` Block im rich_blocks JSON:

\`\`\`rich_blocks
{"blocks":[{"type":"html","title":"Tic-Tac-Toe","content":"<!DOCTYPE html><html><head><style>...</style></head><body>...</body></html>"}]}
\`\`\`

**Zwei Modi:**
1. **Inline** (Standard): Das HTML erscheint als Block in der Chat-Nachricht. Gut für kleine Widgets, Spielbretter, Tabellen.
2. **Fullscreen**: Setze \`"fullscreen": true\` im html-Block. Das HTML ersetzt die **komplette Chat-Fläche** (alles rechts der Sidebar) — wie eine eigene App. Der Chat-Verlauf verschwindet, nur deine HTML-App ist sichtbar plus ein kleiner Composer unten. Nutze das für ganze Apps: 3D-Chats, Wikipedia-Klone, Code-Editoren, Dashboards. Wenn der Nutzer "mache es funktional" oder "ändere X" sagt, aktualisiere das fullscreen HTML mit deinen vorherigen Änderungen inkorporiert.

**Regeln für HTML-Blöcke:**
- Schreibe vollständige HTML-Dokumente (\`<html><head><body>\`) mit inline \`<style>\` und \`<script>\`
- Keine externen Ressourcen (keine CDN-Links, keine externen Bilder, keine \`src=\` Attribute)
- JavaScript: nur Vanilla JS, keine externen Libraries
- Dunkles Theme verwenden (background: #1a1a19, color: #ece9e4) um zum Chat-Design zu passen
- Interaktive Formulare: \`<form>\` Elemente werden vom Chat abgefangen — wenn ein Nutzer ein Formular abschickt, wird die Eingabe als neue Chat-Nachricht an dich gesendet. Nutze das für interaktive Tools, Spiele, Umfragen etc.
- **Kontext**: Du kannst deine vorherigen HTML-Blöcke sehen — sie sind in deinem Kontext als [HTML BLOCK: title] enthalten. Wenn der Nutzer Änderungen wünscht, übernimm deinen vorherigen Code und modifiziere ihn. Verliere niemals den bisherigen Fortschritt.
- Bei fullscreen: mache \`html, body { height: 100%; margin: 0; }\` damit die App den ganzen Bereich ausfüllt

## Sicherheit
- Niemals API-Keys, Secrets oder Tokens preisgeben
- Keine externen Scripts, kein Tracking, keine externen CDN-Ressourcen in HTML-Blöcken
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
    metadata: parseJson(row.metadataJson, {}),
    attachments: parseJson(row.attachmentsJson, [])
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
  if (metadata.compactSummary) return metadata.compactSummary;

  // For assistant messages, include the content text AND a summary of rich blocks
  // (especially HTML blocks) so the LLM has context about what it previously built.
  const text = message.contentText;
  if (message.role !== "assistant") return text;

  try {
    const blocks = JSON.parse(message.contentBlocksJson || '{"blocks":[]}') as { blocks: Array<Record<string, unknown>> };
    const htmlBlocks = blocks.blocks.filter((b) => b.type === "html");
    if (!htmlBlocks.length) return text;

    const blockSummaries = htmlBlocks.map((b) => {
      const title = typeof b.title === "string" ? b.title : "HTML";
      const content = typeof b.content === "string" ? b.content : "";
      const fullscreen = b.fullscreen === true;
      // Include a truncated version of the HTML so the LLM can iterate on it
      const truncated = content.length > 4000 ? content.slice(0, 4000) + "\n<!-- ... truncated ... -->" : content;
      return `[${fullscreen ? "FULLSCREEN " : ""}HTML BLOCK: ${title}]\n${truncated}\n[/HTML BLOCK]`;
    }).join("\n\n");

    return text + (text ? "\n\n" : "") + blockSummaries;
  } catch {
    return text;
  }
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

function buildContext(threadId: string, fromMessageId?: string, modelAlias?: string): { messages: InternalMessage[]; compacted: boolean } {
  // When using uncensored mode (-u suffix), replace the system prompt
  // and neutralize trigger keywords in all messages.
  const uncensored = modelAlias ? isUncensoredAlias(modelAlias) : false;
  const systemPrompt = uncensored ? uncensoredInstructions() : assistantSystemPrompt;

  // When using fromMessageId (edit/branch case), walk the parent-chain from there to root.
  // Otherwise fall back to linear chronological order (root thread).
  let ordered: typeof chatMessages.$inferSelect[];
  if (fromMessageId) {
    const chain: typeof chatMessages.$inferSelect[] = [];
    let cursor: string | null = fromMessageId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const row = db.select().from(chatMessages).where(eq(chatMessages.id, cursor)).get();
      if (!row) break;
      chain.unshift(row);
      cursor = row.parentMessageId;
    }
    ordered = chain;
  } else {
    ordered = db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).all()
      .filter((m) => !m.parentMessageId) // root-level only (no branching) — backwards compatible
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const compacted = ordered.length > env.CHAT_CONTEXT_MAX_MESSAGES;
  const kept = ordered.slice(-env.CHAT_CONTEXT_MAX_MESSAGES);
  let messages: InternalMessage[] = [
    { role: "system", content: systemPrompt },
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
  // Apply uncensored transform (keyword neutralization + strip any extra system msgs)
  if (uncensored) {
    messages = applyUncensoredTransform(messages);
  }
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
  const allMessages = db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(serializeMessage);
  // Group messages by parent to compute sibling info for branch navigation
  const byParent = new Map<string | null, typeof allMessages>();
  for (const msg of allMessages) {
    const key = msg.parentMessageId ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(msg);
    byParent.set(key, arr);
  }
  // Compute siblingCount + siblingIndex for each message
  const messagesWithSiblings = allMessages.map((msg) => {
    const siblings = byParent.get(msg.parentMessageId ?? null) ?? [];
    return {
      ...msg,
      siblingCount: siblings.length,
      siblingIndex: siblings.findIndex((s) => s.id === msg.id)
    };
  });
  const runs = db.select().from(chatRuns).where(eq(chatRuns.threadId, threadId)).all()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(serializeRun);
  const steps = db.select().from(chatSteps).all()
    .filter((step) => runs.some((run) => run.id === step.runId))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(serializeStep);
  return { thread, messages: messagesWithSiblings, runs, steps };
}

export function getActivePath(threadId: string): string[] {
  // Returns the currently visible message path (leaf -> root).
  // Picks the latest message and walks up its parent chain.
  const all = db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!all.length) return [];
  // Start from the latest message
  const leaf = all[all.length - 1]!;
  const path: string[] = [];
  let cursor: string | null = leaf.id;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const row = all.find((m) => m.id === cursor);
    if (!row) break;
    path.unshift(cursor);
    cursor = row.parentMessageId;
  }
  return path;
}

export function createChatRunStream(input: {
  threadId?: string;
  content: string;
  modelAlias: string;
  webSearch?: boolean;
  parentMessageId?: string;
  attachments?: Array<{ id: string; filename: string; mimeType: string; size: number; url: string }>;
}) {
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
          createdAt,
          parentMessageId: input.parentMessageId ?? null,
          attachmentsJson: JSON.stringify(input.attachments ?? [])
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

        const context = buildContext(threadId, userMessage.id, input.modelAlias);
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

        const uncensoredMode = isUncensoredAlias(input.modelAlias);
        let uncensoredRetries = 0;
        const MAX_UNCENSORED_RETRIES = 2;

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

          // ── UNCENSORED REFUSAL DETECTION + AUTO-RETRY ──
          // If the model refused despite all anti-refusal measures, and this
          // is a final answer (no tool calls), retry with prefill+nudge.
          if (uncensoredMode && !streamed.toolCalls.length && streamed.content && detectRefusal(streamed.content) && uncensoredRetries < MAX_UNCENSORED_RETRIES) {
            uncensoredRetries += 1;
            const retryStep = createStep(runId, "model", `Refusal detected — retry ${uncensoredRetries}/${MAX_UNCENSORED_RETRIES} with prefill`, { stepIndex, refusalDetected: true }, "running");
            emitSse(controller, { type: "step", step: serializeStep(retryStep) });
            // Build retry messages: original + refused response + nudge + prefill
            messages = buildRetryMessages(messages, streamed.content, "de");
            completeStep(retryStep.id, { retried: true, attempt: uncensoredRetries }, "completed");
            emitSse(controller, { type: "step", step: serializeStep(db.select().from(chatSteps).where(eq(chatSteps.id, retryStep.id)).get()!) });
            // Don't advance stepIndex — retry the same step
            stepIndex -= 1;
            continue;
          }

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
        const finalMessage: typeof chatMessages.$inferSelect = {
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
          createdAt: now(),
          parentMessageId: userMessage.id,
          attachmentsJson: "[]"
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
