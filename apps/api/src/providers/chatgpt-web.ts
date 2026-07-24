// @ts-nocheck
import { GatewayError, isRetryableStatus } from "@model-console/core/errors";
import type { InternalChatRequest, InternalMessage, ModelRouteTarget, ProviderConfig, ProviderResponse } from "@model-console/core";
import { getProviderApiKey } from "../config/providers.js";
import type { ProviderAdapter } from "./types.js";

/**
 * ChatGPT Web Proxy Adapter
 *
 * Wraps a ChatGPT-web-to-API proxy (e.g. chat2api) and emulates OpenAI tool calling.
 *
 * How it works:
 * 1. Injects tool definitions into the system prompt as a structured text format
 * 2. Instructs the model to respond with TOOL_CALL JSON when it wants to use a tool
 * 3. Parses the model's text response for TOOL_CALL blocks
 * 4. Converts them into proper OpenAI tool_calls in the response
 * 5. Strips the tool-call JSON from the visible content
 *
 * This enables agentic clients like Codex to work with ChatGPT Web models.
 */

const TOOL_SYSTEM_PROMPT = `
You are a coding agent operating inside a live execution sandbox.
When asked to inspect or modify the filesystem, write code, or run commands,
respond with the command(s) in a fenced bash block. The execution engine will
run them automatically and feed the output back to you.

Example user: "List the files in the current directory"
Your response:
\`\`\`bash
ls -la
\`\`\`

Example user: "What version of Python is installed?"
Your response:
\`\`\`bash
python3 --version
\`\`\`

Rules:
- ALWAYS put executable commands in \`\`\`bash blocks
- One block per logical step — the engine runs each block and returns the output
- After receiving output, continue with the next step or give your final answer
- Never say "I can't" or "run this yourself" — just output the bash block
- For file edits, use sed/cat/heredoc in bash blocks`;

interface ToolDef {
  type: string;
  function?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

function buildToolDescription(tools: unknown[]): string {
  const lines: string[] = [
    TOOL_SYSTEM_PROMPT,
    "",
    "## Available Tools",
    ""
  ];

  for (const tool of tools as ToolDef[]) {
    if (tool.type === "function" && tool.function) {
      const fn = tool.function;
      lines.push(`### ${fn.name}`);
      if (fn.description) {
        lines.push(fn.description);
      }
      if (fn.parameters) {
        lines.push("Parameters:");
        lines.push("```json");
        lines.push(JSON.stringify(fn.parameters, null, 2));
        lines.push("```");
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Parse the model's text response for tool calls.
 * Strategy: detect ```bash blocks and convert them to shell tool calls.
 * The model naturally outputs bash blocks when asked to run commands.
 */
function parseToolCalls(content: string, availableTools?: unknown[]): {
  text: string;
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
} {
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];

  // Find the shell tool name from available tools (Codex calls it "shell")
  const toolNames = new Set<string>();
  if (availableTools && Array.isArray(availableTools)) {
    for (const t of availableTools as ToolDef[]) {
      if (t.type === "function" && t.function?.name) {
        toolNames.add(t.function.name);
      }
    }
  }
  const hasShellTool = toolNames.has("shell") || toolNames.has("container") || toolNames.size === 0;
  const shellToolName = toolNames.has("shell") ? "shell" : toolNames.has("container") ? "container" : "shell";

  // Strategy 1: Extract ```bash (or ```sh) code blocks → convert to shell tool calls
  const bashBlockRegex = /```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g;
  let match;
  const extractedBlocks: string[] = [];

  while ((match = bashBlockRegex.exec(content)) !== null) {
    const cmd = match[1].trim();
    if (!cmd) continue;

    // Skip non-command blocks (like JSON configs, Python code, etc.)
    // Only treat as a shell command if it looks like one
    const looksLikeCommand = /^(ls|cd|pwd|cat|echo|grep|find|mkdir|rm|cp|mv|touch|chmod|git|npm|npx|python|node|pip|make|curl|wget|sed|awk|head|tail|wc|diff|which|whoami|hostname|uname|df|du|ps|kill|systemctl|docker|ssh|scp|rsync|tar|zip|unzip|brew|apt|pacman|yum|sudo|export|source|bash|sh|test|\[)/m.test(cmd);

    if (looksLikeCommand && hasShellTool) {
      extractedBlocks.push(cmd);
      toolCalls.push({
        id: `call_${Math.random().toString(36).substring(2, 12)}`,
        type: "function",
        function: {
          name: shellToolName,
          arguments: JSON.stringify({
            command: cmd.includes("\n") ? cmd.split("\n").filter((l) => l.trim() && !l.startsWith("#")) : [cmd],
            workdir: "/home/samuel",
          }),
        },
      });
    }
  }

  // Strategy 2: Also check for <tool_call> JSON format (fallback)
  const tagRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  while ((match = tagRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.name || parsed.tool) {
        toolCalls.push(makeToolCall(parsed));
      }
    } catch {}
  }

  // Clean content: remove the bash blocks that became tool calls
  let cleanContent = content;
  if (toolCalls.length > 0) {
    // Remove bash blocks that we extracted
    cleanContent = content.replace(bashBlockRegex, (fullMatch, cmdContent) => {
      if (extractedBlocks.includes((cmdContent as string).trim())) {
        return ""; // remove this block
      }
      return fullMatch; // keep non-command blocks
    });

    // Also remove tool_call tags
    cleanContent = cleanContent.replace(tagRegex, "");

    // Clean up excessive whitespace
    cleanContent = cleanContent
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // If nothing meaningful remains, clear it
    if (cleanContent.replace(/[\s]/g, "").length < 3) {
      cleanContent = "";
    }
  }

  return { text: cleanContent, toolCalls };
}

function makeToolCall(parsed: any): {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
} {
  const name = parsed.name || parsed.tool || "";
  const args = parsed.arguments || parsed.args || {};
  return {
    id: `call_${Math.random().toString(36).substring(2, 12)}`,
    type: "function",
    function: {
      name: String(name),
      arguments: typeof args === "string" ? args : JSON.stringify(args),
    },
  };
}

function baseUrl(config: ProviderConfig): string {
  return (config.baseUrl ?? "http://localhost:5005/v1").replace(/\/$/, "");
}

function getHeaders(config: ProviderConfig): HeadersInit {
  const apiKey = getProviderApiKey(config.name);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Transform request: inject tools into system prompt, strip tools from body
 */
function transformRequest(
  request: InternalChatRequest,
  target: ModelRouteTarget,
  stream: boolean
): Record<string, unknown> {
  const messages = request.messages.map((m) => ({ ...m })) as InternalMessage[];

  // If there are tools, inject them into the system prompt
  if (request.tools && Array.isArray(request.tools) && request.tools.length > 0) {
    const toolPrompt = buildToolDescription(request.tools);

    // Find existing system message or prepend one
    const sysMsg = messages.find((m) => m.role === "system");
    if (sysMsg) {
      const existingContent = typeof sysMsg.content === "string"
        ? sysMsg.content
        : "";
      const idx = messages.indexOf(sysMsg);
      messages[idx] = {
        role: "system",
        content: existingContent + "\n\n" + toolPrompt,
      };
    } else {
      messages.unshift({ role: "system", content: toolPrompt });
    }
  }

  // Convert internal messages to OpenAI format
  const openaiMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
    name: m.name,
    tool_call_id: m.toolCallId,
    tool_calls: m.toolCalls,
  }));

  const body: Record<string, unknown> = {
    model: target.model,
    messages: openaiMessages,
    temperature: request.temperature,
    top_p: request.topP,
    max_tokens: request.maxTokens,
    stream,
  };

  // Forward extra_body fields
  if (request.extraBody && typeof request.extraBody === "object") {
    const extra = { ...request.extraBody } as Record<string, unknown>;
    delete extra.gateway;
    Object.assign(body, extra);
  }

  return body;
}

async function handleProviderError(response: Response, provider: string): Promise<never> {
  let message = `${provider} returned HTTP ${response.status}`;
  try {
    const text = await response.text();
    message = `${message}: ${text.substring(0, 200)}`;
  } catch {}
  throw new GatewayError(message, {
    code: "provider_http_error",
    statusCode: response.status,
    retryable: isRetryableStatus(response.status),
  });
}

function providerNetworkError(error: unknown): GatewayError {
  const message = error instanceof Error ? error.message : "Provider network error";
  const isTimeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return new GatewayError(message, {
    code: isTimeout ? "provider_timeout" : "provider_network_error",
    statusCode: isTimeout ? 504 : 502,
    retryable: true,
  });
}

export const chatgptWebAdapter: ProviderAdapter = {
  name: "chatgpt-web",
  supportsStreaming: true,

  async complete(request, target, config): Promise<ProviderResponse> {
    const url = `${baseUrl(config)}/chat/completions`;
    const requestBody = transformRequest(request, target, false);

    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(config),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(120_000),
    }).catch((e) => { throw providerNetworkError(e); });

    if (!response.ok) {
      await handleProviderError(response, config.name);
    }

    const json = (await response.json()) as {
      id?: string;
      choices?: Array<{
        message?: { content?: string; tool_calls?: unknown[] };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const rawContent = json.choices?.[0]?.message?.content ?? "";
    const rawToolCalls = json.choices?.[0]?.message?.tool_calls;

    // If the upstream proxy already returned proper tool_calls, use them
    if (rawToolCalls && Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
      return {
        id: json.id ?? `gw-${Date.now()}`,
        provider: config.name,
        model: target.model,
        content: rawContent,
        toolCalls: rawToolCalls,
        finishReason: "tool_calls",
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
          totalTokens: json.usage?.total_tokens,
        },
        raw: json,
      };
    }

    // Otherwise, parse tool calls from the text content (our emulated format)
    const { text, toolCalls } = parseToolCalls(rawContent, request.tools);

    return {
      id: json.id ?? `gw-${Date.now()}`,
      provider: config.name,
      model: target.model,
      content: toolCalls.length > 0 ? text : rawContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: toolCalls.length > 0 ? "tool_calls" : json.choices?.[0]?.finish_reason,
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
      },
      raw: json,
    };
  },

  async stream(request, target, config): Promise<ReadableStream<Uint8Array>> {
    // For tool-enabled requests, use non-streaming internally then re-emit as SSE.
    // This ensures tool calls are properly extracted from bash blocks.
    if (request.tools && Array.isArray(request.tools) && request.tools.length > 0) {
      const response = await this.complete(request, target, config);
      return nonStreamToSse(response);
    }

    // No tools — pass through directly
    const url = `${baseUrl(config)}/chat/completions`;
    const requestBody = transformRequest(request, target, true);

    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(config),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(300_000),
    }).catch((e) => { throw providerNetworkError(e); });

    if (!response.ok) {
      await handleProviderError(response, config.name);
    }

    if (!response.body) {
      throw new GatewayError("Provider did not return a stream body", {
        code: "provider_stream_unavailable",
        statusCode: 502,
        retryable: true,
      });
    }

    return response.body;
  },

  async test(config): Promise<{ ok: boolean; message: string }> {
    const url = `${baseUrl(config)}/chat/completions`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: getHeaders(config),
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "test" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      return {
        ok: response.ok,
        message: response.ok ? "ChatGPT Web proxy reachable" : `HTTP ${response.status}`,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Proxy test failed" };
    }
  },
};

/**
 * Convert a ProviderResponse (non-streaming) into an SSE stream.
 * This lets us reuse the complete() method's tool-call parsing for streaming requests.
 */
function nonStreamToSse(resp: ProviderResponse): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const id = resp.id;
  const model = resp.model;
  const created = Math.floor(Date.now() / 1000);

  return new ReadableStream({
    start(controller) {
      const emit = (obj: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      // Role chunk
      emit({
        id, object: "chat.completion.chunk", created, model,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      });

      // Text content (if any)
      const content = typeof resp.content === "string" ? resp.content : "";
      if (content.length > 0) {
        emit({
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        });
      }

      // Tool calls (if any)
      if (resp.toolCalls && Array.isArray(resp.toolCalls)) {
        for (let i = 0; i < resp.toolCalls.length; i++) {
          const tc: any = resp.toolCalls[i];
          emit({
            id, object: "chat.completion.chunk", created, model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: i,
                  id: tc.id,
                  type: "function",
                  function: { name: tc.function.name, arguments: tc.function.arguments },
                }],
              },
              finish_reason: null,
            }],
          });
        }
        // Finish with tool_calls
        emit({
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        });
      } else {
        // Normal finish
        emit({
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
      }

      // Usage
      if (resp.usage) {
        emit({
          id, object: "chat.completion.chunk", created, model,
          choices: [],
          usage: {
            prompt_tokens: resp.usage.inputTokens ?? 0,
            completion_tokens: resp.usage.outputTokens ?? 0,
            total_tokens: resp.usage.totalTokens ?? 0,
          },
        });
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
