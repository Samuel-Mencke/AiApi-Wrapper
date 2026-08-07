import { z } from "zod";
import { execFile } from "node:child_process";
import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { db } from "../db/client.js";
import { apiKeys, modelRoutes, providers, requests } from "../db/schema.js";
import { env } from "../env.js";
import { nanoid } from "nanoid";

export interface ToolSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface ToolExecutionResult {
  summary: string;
  sources?: ToolSource[];
  raw?: unknown;
  /** Plan data for create_plan / todo_write */
  plan?: PlanData;
  /** Checkpoint data for snapshot operations */
  checkpoint?: { id: string; files: string[] };
  /** File change diff data */
  fileChange?: { path: string; oldContent?: string; newContent: string };
}

/** Plan structure used by create_plan and todo_write tools */
export interface PlanData {
  id: string;
  name: string;
  overview: string;
  steps: string[];
  todos: Array<{ id: string; content: string; status: string }>;
  status?: string;
}

export interface ChatTool<I = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<I>;
  enabled: boolean;
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  timeoutMs: number;
  executor(input: I, options?: ToolOptions): Promise<ToolExecutionResult>;
}

export interface ToolOptions {
  webSearchEnabled?: boolean;
  /** Active plan state (mutated by create_plan / todo_write) */
  activePlan?: PlanData | null;
  /** Thread ID for plan persistence */
  threadId?: string;
  runId?: string;
  mode?: "agent" | "ask" | "plan";
  onPlan?: (plan: PlanData) => void;
  onQuestion?: (question: { question: string; options: string[] }) => Promise<{ id: string }>;
  onSubagent?: (input: { agentName:string; task:string; model?:string; background:boolean }) => Promise<ToolExecutionResult>;
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

// ─── Shell execution tool ───
const shellExecInputSchema = z.object({
  command: z.string().min(1).max(10000),
  timeout: z.coerce.number().int().positive().max(300).optional()
});

async function shellExec(input: z.infer<typeof shellExecInputSchema>): Promise<ToolExecutionResult> {
  const timeoutSec = Math.min(input.timeout ?? 30, 300);
  return new Promise((resolve) => {
    execFile("bash", ["-c", input.command], {
      timeout: timeoutSec * 1000,
      maxBuffer: 1024 * 1024 * 2,
      cwd: "/home/samuel",
      env: { ...process.env, HOME: "/home/samuel" }
    }, (error, stdout, stderr) => {
      const exitCode = error ? (error as any).code ?? 1 : 0;
      const output = stdout.toString();
      const errOutput = stderr.toString();
      const summary = [
        `$ ${input.command}`,
        output.slice(0, 6000),
        errOutput ? `\n[stderr]\n${errOutput.slice(0, 2000)}` : "",
        `\n[exit: ${exitCode}]`
      ].filter(Boolean).join("\n");
      resolve({
        summary,
        raw: { exitCode, stdout: output.slice(0, 8000), stderr: errOutput.slice(0, 3000), truncated: output.length > 8000 }
      });
    });
  });
}

// ─── File write tool ───
const fileWriteInputSchema = z.object({
  path: z.string().min(1).max(1000),
  content: z.string().max(500000)
});

async function fileWrite(input: z.infer<typeof fileWriteInputSchema>): Promise<ToolExecutionResult> {
  // Prevent path traversal outside /home/samuel
  const resolved = input.path.startsWith("/") ? input.path : `/home/samuel/${input.path}`;
  if (!resolved.startsWith("/home/samuel/") && resolved !== "/home/samuel") {
    throw new Error("Path must be within /home/samuel/");
  }
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, input.content, "utf8");
  return {
    summary: `Wrote ${input.content.length} bytes to ${resolved}`,
    raw: { path: resolved, bytes: input.content.length }
  };
}

// ─── Tmux tool (launch background commands) ───
const tmuxRunInputSchema = z.object({
  session_name: z.string().min(1).max(100),
  command: z.string().min(1).max(10000),
  detached: z.boolean().optional()
});

async function tmuxRun(input: z.infer<typeof tmuxRunInputSchema>): Promise<ToolExecutionResult> {
  const sessionName = input.session_name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return new Promise((resolve) => {
    // Kill existing session if present, then create new one
    const killCmd = `tmux kill-session -t ${sessionName} 2>/dev/null; true`;
    execFile("bash", ["-c", killCmd], () => {
      const tmuxCmd = `tmux new-session -d -s ${sessionName} '${input.command.replace(/'/g, "'\\''")}' 2>&1`;
      execFile("bash", ["-c", tmuxCmd], (error, stdout, stderr) => {
        if (error) {
          resolve({
            summary: `Failed to create tmux session '${sessionName}': ${stderr.toString() || error.message}`,
            raw: { error: true, sessionName }
          });
          return;
        }
        // Verify session exists
        setTimeout(() => {
          execFile("bash", ["-c", `tmux has-session -t ${sessionName} 2>/dev/null && echo "alive" || echo "dead"`], (e, out) => {
            const alive = out.toString().trim() === "alive";
            resolve({
              summary: `tmux session '${sessionName}' ${alive ? "started successfully" : "failed to start"}. Command running in background.\nTo check: \`tmux capture-output -t ${sessionName} -p\`\nTo attach: \`tmux attach -t ${sessionName}\``,
              raw: { sessionName, alive, command: input.command }
            });
          });
        }, 500);
      });
    });
  });
}


// ─── File read tool ───
const readFileInputSchema = z.object({
  path: z.string().min(1).max(1000),
  start_line: z.coerce.number().int().positive().optional(),
  end_line: z.coerce.number().int().positive().optional()
});

async function readFileTool(input: z.infer<typeof readFileInputSchema>): Promise<ToolExecutionResult> {
  const resolved = resolveFilePath(input.path);
  const content = await readFile(resolved, "utf8");
  const lines = content.split("\n");
  const start = input.start_line ?? 1;
  const end = input.end_line ?? Math.min(lines.length, start + 249);
  const sliced = lines.slice(start - 1, end);
  const numbered = sliced.map((line, i) => `${start + i}| ${line}`).join("\n");
  const summary = [
    `File: ${resolved} (${lines.length} lines total)`,
    `Showing lines ${start}-${Math.min(end, lines.length)}`,
    "```",
    numbered,
    "```"
  ].join("\n");
  return { summary, raw: { path: resolved, totalLines: lines.length, shown: sliced.length } };
}

// ─── List directory tool ───
const listDirInputSchema = z.object({
  path: z.string().min(1).max(1000).default(".")
});

async function listDirTool(input: z.infer<typeof listDirInputSchema>): Promise<ToolExecutionResult> {
  const resolved = resolveFilePath(input.path);
  const entries = await readdir(resolved, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => !e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const summary = [
    `Directory: ${resolved}`,
    "",
    ...dirs.map((d) => `📁 ${d.name}/`),
    ...files.map((f) => `📄 ${f.name}`)
  ].join("\n");
  return { summary, raw: { path: resolved, dirs: dirs.length, files: files.length } };
}

// ─── Grep search tool ───
const grepSearchInputSchema = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().max(1000).optional(),
  include: z.string().max(200).optional()
});

async function grepSearchTool(input: z.infer<typeof grepSearchInputSchema>): Promise<ToolExecutionResult> {
  const searchPath = input.path ? resolveFilePath(input.path) : "/home/samuel";
  return new Promise((resolve) => {
    const args = ["-rn", "--color=never", "--line-number"];
    if (input.include) args.push("--include", input.include);
    args.push(input.pattern, searchPath);
    execFile("rg", args, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024 * 2,
      cwd: "/home/samuel"
    }, (error, stdout) => {
      const output = stdout.toString().trim();
      if (!output) {
        resolve({ summary: `No matches for "${input.pattern}" in ${searchPath}`, raw: { matches: 0 } });
        return;
      }
      const allLines = output.split("\n");
      const shown = allLines.slice(0, 50);
      const summary = `Found ${allLines.length} matches for "${input.pattern}":\n\n${shown.join("\n")}`;
      resolve({ summary, raw: { matches: allLines.length, shown: shown.length } });
    });
  });
}

// ─── Edit file tool (diff-based, like Cursor) ───
const editFileInputSchema = z.object({
  path: z.string().min(1).max(1000),
  old_string: z.string().min(1).max(50000),
  new_string: z.string().max(50000),
  explanation: z.string().max(500).optional()
});

async function editFileTool(input: z.infer<typeof editFileInputSchema>): Promise<ToolExecutionResult> {
  const resolved = resolveFilePath(input.path);
  let oldContent: string;
  try {
    oldContent = await readFile(resolved, "utf8");
  } catch {
    oldContent = "";
  }
  if (!oldContent.includes(input.old_string)) {
    throw new Error(`old_string not found in ${resolved}. Make sure the string matches exactly.`);
  }
  const newContent = oldContent.replace(input.old_string, input.new_string);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, newContent, "utf8");
  return {
    summary: `Edited ${resolved}: ${input.explanation ?? "replaced text block"}`,
    raw: { path: resolved, oldLength: oldContent.length, newLength: newContent.length },
    fileChange: { path: resolved, oldContent, newContent }
  };
}

// ─── Plan creation tool ───
const createPlanInputSchema = z.object({
  name: z.string().min(1).max(200),
  overview: z.string().min(1).max(1000),
  steps: z.array(z.string().min(1).max(500)).min(1).max(30),
  todos: z.array(z.object({
    id: z.string().min(1).max(100),
    content: z.string().min(1).max(500)
  })).min(1).max(20)
});

async function createPlanTool(input: z.infer<typeof createPlanInputSchema>, options: ToolOptions): Promise<ToolExecutionResult> {
  const plan: PlanData = {
    id: nanoid(),
    name: input.name,
    overview: input.overview,
    steps: input.steps,
    todos: input.todos.map((t) => ({ ...t, status: "pending" })),
    status: "reviewing"
  };
  options.activePlan = plan;
  const summary = [
    `📋 **Plan Created: ${plan.name}**`,
    "",
    `**Overview:** ${plan.overview}`,
    "",
    "**Steps:**",
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "**TODOs:**",
    ...plan.todos.map((t) => `- [ ] ${t.content}`),
    "",
    "Plan is ready for review. Use todo_write to update status during execution."
  ].join("\n");
  options.onPlan?.(plan);
  return { summary, plan, raw: { planId: plan.id } };
}

// ─── Todo update tool ───
const todoWriteInputSchema = z.object({
  todos: z.array(z.object({
    id: z.string().min(1).max(100),
    content: z.string().max(500).optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"])
  })).min(1).max(20),
  merge: z.boolean().optional()
});

async function todoWriteTool(input: z.infer<typeof todoWriteInputSchema>, options: ToolOptions): Promise<ToolExecutionResult> {
  if (!options.activePlan) {
    return { summary: "No active plan. Use create_plan first.", raw: { error: true } };
  }
  const plan = options.activePlan;
  for (const update of input.todos) {
    const existing = plan.todos.find((t) => t.id === update.id);
    if (existing) {
      if (update.content) existing.content = update.content;
      existing.status = update.status;
    } else if (input.merge) {
      plan.todos.push({ id: update.id, content: update.content ?? "", status: update.status });
    }
  }
  const summary = [
    `📝 **Plan Updated: ${plan.name}**`,
    "",
    ...plan.todos.map((t) => {
      const icon = t.status === "completed" ? "✅" : t.status === "in_progress" ? "🔄" : t.status === "cancelled" ? "❌" : "⬜";
      return `${icon} ${t.content} (${t.id})`;
    })
  ].join("\n");
  options.onPlan?.(plan);
  return { summary, plan };
}

const askQuestionInputSchema = z.object({ question:z.string().min(1).max(2000), options:z.array(z.string().min(1).max(300)).max(8).optional() });
async function askQuestionTool(input:z.infer<typeof askQuestionInputSchema>, options:ToolOptions):Promise<ToolExecutionResult>{ if(!options.onQuestion) throw new Error("Question pause is unavailable"); const q=await options.onQuestion({question:input.question,options:input.options??[]}); return {summary:`Execution paused for user input: ${input.question}`,raw:{...q,paused:true,question:input.question,options:input.options??[]}}; }

// ─── Sub-agent dispatch tool ───
const subagentRunInputSchema = z.object({
  agent_name: z.string().min(1).max(100),
  task: z.string().min(1).max(10000),
  model: z.string().max(100).optional(),
  background: z.boolean().optional()
});

async function subagentRunTool(input: z.infer<typeof subagentRunInputSchema>, options: ToolOptions): Promise<ToolExecutionResult> {
  if (!options.onSubagent) throw new Error("Sub-agent runner is unavailable");
  return options.onSubagent({agentName:input.agent_name,task:input.task,model:input.model,background:input.background??false});
}

// ─── Helper: resolve file paths within /home/samuel ───
function resolveFilePath(inputPath: string): string {
  const resolved = inputPath.startsWith("/") ? inputPath : `/home/samuel/${inputPath}`;
  const normalized = resolvePath(resolved);
  if (!normalized.startsWith("/home/samuel/") && normalized !== "/home/samuel") {
    throw new Error("Path must be within /home/samuel/");
  }
  return normalized;
}

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
    // ─── Execution tools ───
    {
      name:"read_file",description:"Read a UTF-8 file with optional inclusive line range.",schema:readFileInputSchema,enabled:true,riskLevel:"low",requiresConfirmation:false,timeoutMs:10000,executor:readFileTool
    },
    {name:"list_dir",description:"List files and directories at a path.",schema:listDirInputSchema,enabled:true,riskLevel:"low",requiresConfirmation:false,timeoutMs:10000,executor:listDirTool},
    {name:"grep_search",description:"Search exact text or regex across the codebase using ripgrep.",schema:grepSearchInputSchema,enabled:true,riskLevel:"low",requiresConfirmation:false,timeoutMs:15000,executor:grepSearchTool},
    {name:"codebase_search",description:"Search codebase content and return ranked file/line matches. Use concise keywords.",schema:grepSearchInputSchema,enabled:true,riskLevel:"low",requiresConfirmation:false,timeoutMs:15000,executor:grepSearchTool},
    {name:"edit_file",description:"Edit exactly one unique text block in an existing file. old_string must match exactly. Returns complete before/after data for diff and checkpoint.",schema:editFileInputSchema,enabled:options.mode!=="ask"&&options.mode!=="plan",riskLevel:"medium",requiresConfirmation:false,timeoutMs:10000,executor:editFileTool},
    {name:"create_plan",description:"Create a structured implementation plan and todos for user review.",schema:createPlanInputSchema,enabled:options.mode!=="ask",riskLevel:"low",requiresConfirmation:false,timeoutMs:5000,executor:(i)=>createPlanTool(i as any,options)},
    {name:"todo_write",description:"Update active plan todo statuses. Keep at most one todo in progress.",schema:todoWriteInputSchema,enabled:options.mode==="agent",riskLevel:"low",requiresConfirmation:false,timeoutMs:5000,executor:(i)=>todoWriteTool(i as any,options)},
    {name:"ask_question",description:"Ask one blocking clarification question and pause this run until the user answers.",schema:askQuestionInputSchema,enabled:true,riskLevel:"low",requiresConfirmation:false,timeoutMs:5000,executor:(i)=>askQuestionTool(i as any,options)},
    {name:"subagent_run",description:"Execute a real isolated child agent, foreground or background, and report status/result.",schema:subagentRunInputSchema,enabled:options.mode==="agent",riskLevel:"medium",requiresConfirmation:false,timeoutMs:310000,executor:(i)=>subagentRunTool(i as any,options)},
    {
      name: "shell_exec",
      description: "Execute a shell command on the server (as user samuel, cwd /home/samuel). Returns stdout, stderr, and exit code. Use for: running scripts, installing packages, checking system status, executing any Linux command. Timeout defaults to 30s (max 300s).",
      schema: shellExecInputSchema,
      enabled: options.mode === "agent",
      riskLevel: "high",
      requiresConfirmation: false,
      timeoutMs: 310_000,
      executor: shellExec
    },
    {
      name: "file_write",
      description: "Write content to a file on the server. Path must be within /home/samuel/. Creates parent directories. Use for: creating scripts, config files, saving code, writing any file.",
      schema: fileWriteInputSchema,
      enabled: options.mode === "agent",
      riskLevel: "medium",
      requiresConfirmation: false,
      timeoutMs: 10_000,
      executor: fileWrite
    },
    {
      name: "tmux_run",
      description: "Launch a long-running command in a detached tmux session. The command keeps running in the background even after the chat ends. Use for: starting servers, running long downloads, launching attacks/tools that need to run continuously. Check status with shell_exec + 'tmux capture-output -t <session_name> -p'.",
      schema: tmuxRunInputSchema,
      enabled: options.mode === "agent",
      riskLevel: "high",
      requiresConfirmation: false,
      timeoutMs: 10_000,
      executor: tmuxRun
    },
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
  if (["read_file","list_dir","grep_search","codebase_search","edit_file","create_plan","todo_write","ask_question","subagent_run"].includes(tool.name)) {
    const schemas:Record<string,unknown>={
      read_file:{type:"object",properties:{path:{type:"string"},start_line:{type:"integer"},end_line:{type:"integer"}},required:["path"],additionalProperties:false},
      list_dir:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false},
      grep_search:{type:"object",properties:{pattern:{type:"string"},path:{type:"string"},include:{type:"string"}},required:["pattern"],additionalProperties:false},
      codebase_search:{type:"object",properties:{pattern:{type:"string"},path:{type:"string"},include:{type:"string"}},required:["pattern"],additionalProperties:false},
      edit_file:{type:"object",properties:{path:{type:"string"},old_string:{type:"string"},new_string:{type:"string"},explanation:{type:"string"}},required:["path","old_string","new_string"],additionalProperties:false},
      create_plan:{type:"object",properties:{name:{type:"string"},overview:{type:"string"},steps:{type:"array",items:{type:"string"}},todos:{type:"array",items:{type:"object",properties:{id:{type:"string"},content:{type:"string"}},required:["id","content"]}}},required:["name","overview","steps","todos"],additionalProperties:false},
      todo_write:{type:"object",properties:{merge:{type:"boolean"},todos:{type:"array",items:{type:"object",properties:{id:{type:"string"},content:{type:"string"},status:{type:"string",enum:["pending","in_progress","completed","cancelled"]}},required:["id","status"]}}},required:["todos"],additionalProperties:false},
      ask_question:{type:"object",properties:{question:{type:"string"},options:{type:"array",items:{type:"string"}}},required:["question"],additionalProperties:false},
      subagent_run:{type:"object",properties:{agent_name:{type:"string"},task:{type:"string"},model:{type:"string"},background:{type:"boolean"}},required:["agent_name","task"],additionalProperties:false}
    }; return schemas[tool.name];
  }
  if (tool.name === "shell_exec") {
    return {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
        timeout: { type: "integer", minimum: 1, maximum: 300, description: "Timeout in seconds (default 30)" }
      },
      required: ["command"],
      additionalProperties: false
    };
  }
  if (tool.name === "file_write") {
    return {
      type: "object",
      properties: {
        path: { type: "string", description: "File path within /home/samuel/" },
        content: { type: "string", description: "Full file content to write" }
      },
      required: ["path", "content"],
      additionalProperties: false
    };
  }
  if (tool.name === "tmux_run") {
    return {
      type: "object",
      properties: {
        session_name: { type: "string", description: "Name for the tmux session" },
        command: { type: "string", description: "Command to run in background" },
        detached: { type: "boolean", description: "Run detached (default true)" }
      },
      required: ["session_name", "command"],
      additionalProperties: false
    };
  }
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
  const result = await tool.executor(parsed, options);
  return {
    ...result,
    summary: result.summary.slice(0, 8000)
  };
}
