"use client";

import "katex/dist/katex.min.css";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BlockMath } from "react-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Archive, BrainCircuit, Check, ChevronDown, Clock3, Copy, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RotateCcw, Search, Send, Sparkles, Square, X } from "lucide-react";
import { API_BASE_URL, apiFetch } from "@/lib/api";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

type Role = "user" | "assistant" | "tool";
type ModelStatus = "verified" | "untested" | "failed";

interface ThreadRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface ChatModel {
  alias: string;
  provider: string;
  realModel: string;
  fallbackCount: number;
  status: ModelStatus;
  statusMessage: string | null;
  latencyMs: number | null;
  modelCapabilities?: {
    supportsReasoning: boolean;
    exposesReasoningSummary: boolean;
    supportsTools: boolean;
    supportsRichBlocks: boolean;
  };
}

interface ChatTool {
  name: string;
  description: string;
  enabled: boolean;
}

type RichBlock =
  | { type: "markdown"; content: string }
  | { type: "code"; language?: string; filename?: string; content: string }
  | { type: "table"; title?: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string | number | boolean | null>>; filterable?: boolean }
  | { type: "chart"; chartType: "bar" | "line" | "pie" | "scatter"; title?: string; xKey?: string; series: Array<{ dataKey: string; label?: string; valueSuffix?: string }>; data: Array<Record<string, string | number | boolean | null>> }
  | { type: "function_plot"; title?: string; expression: string; points?: Array<{ x: number; y: number }> }
  | { type: "math"; content: string; display?: boolean }
  | { type: "html"; title?: string; content?: string }
  | { type: "tool_call"; toolName: string; input: Record<string, unknown>; status: string }
  | { type: "tool_result"; toolName: string; summary: string; sources?: Array<{ title: string; url: string }> }
  | { type: "status"; status: string; content?: string }
  | { type: "error"; message: string; rawJson?: unknown }
  | { type: string; [key: string]: unknown };

interface ChatMessage {
  id: string;
  threadId: string;
  role: Role;
  contentText: string;
  contentBlocks?: { blocks: RichBlock[] };
  modelAlias: string | null;
  provider: string | null;
  realModel: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface ChatRun {
  id: string;
  threadId: string;
  status: string;
  modelAlias: string;
  provider: string | null;
  realModel: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCost: number | null;
  error: string | null;
}

interface ChatStep {
  id: string;
  runId: string;
  messageId: string | null;
  type: "model" | "tool" | "compact" | "error" | "status";
  name: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  latencyMs: number | null;
  status: string;
}

interface ThreadPayload {
  thread: ThreadRow;
  messages: ChatMessage[];
  runs: ChatRun[];
  steps: ChatStep[];
}

const colors = ["#4ec85a", "#9ca3af", "#d4d4d8", "#8b8d98", "#71717a", "#52525b"];

function useAutoScroll<T>(dependency: T) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [dependency]);
  return ref;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.025] px-2 text-xs text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="chat-markdown max-w-none text-[15px] leading-7 text-zinc-100">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-4 mt-7 text-2xl font-semibold leading-tight text-zinc-50 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-7 text-xl font-semibold leading-tight text-zinc-50 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-6 text-base font-semibold leading-snug text-zinc-50 first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
          em: ({ children }) => <em className="text-zinc-200">{children}</em>,
          blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-white/[0.16] pl-4 text-zinc-300">{children}</blockquote>,
          hr: () => <hr className="my-7 border-white/[0.07]" />,
          table: ({ children }) => <div className="my-4 overflow-x-auto rounded-lg border border-white/[0.075]"><table className="min-w-full border-collapse text-left text-sm">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-white/[0.035] text-xs text-zinc-400">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-white/[0.055]">{children}</tbody>,
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-semibold text-zinc-200">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 align-top text-zinc-300">{children}</td>,
          img: ({ alt }) => <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-zinc-400">image blocked{alt ? `: ${alt}` : ""}</span>,
          a: ({ href, children }) => {
            const safe = href?.startsWith("http://") || href?.startsWith("https://");
            return safe ? <a className="text-zinc-100 underline decoration-white/30 underline-offset-4 hover:decoration-white/70" href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
          },
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children);
            const language = /language-(\w+)/.exec(className ?? "")?.[1];
            return language ? <CodeBlock language={language} content={text.replace(/\n$/, "")} /> : <code className="rounded bg-white/[0.065] px-1.5 py-0.5 text-[0.9em] text-zinc-100">{children}</code>;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, filename, content }: { language?: string; filename?: string; content: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-lg border border-white/[0.075] bg-[#0f0f10]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.055] px-3 py-2">
        <div className="min-w-0 truncate text-xs text-zinc-500">{filename ?? language ?? "code"}</div>
        <CopyButton value={content} />
      </div>
      <SyntaxHighlighter
        language={language ?? "text"}
        style={oneDark}
        customStyle={{ margin: 0, background: "transparent", fontSize: 13, lineHeight: 1.65 }}
        PreTag="div"
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}

function TableBlock({ block }: { block: Extract<RichBlock, { type: "table" }> }) {
  const [sortKey, setSortKey] = useState(block.columns[0]?.key ?? "");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const filtered = filter
      ? block.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(filter.toLowerCase()))
      : block.rows;
    return [...filtered].sort((a, b) => {
      const left = String(a[sortKey] ?? "");
      const right = String(b[sortKey] ?? "");
      return direction === "asc" ? left.localeCompare(right, undefined, { numeric: true }) : right.localeCompare(left, undefined, { numeric: true });
    });
  }, [block.rows, direction, filter, sortKey]);
  return (
    <div className="rounded-lg border border-white/[0.075] bg-[#151516]">
      <div className="flex flex-col gap-2 border-b border-white/[0.055] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-zinc-100">{block.title ?? "Table"}</div>
        <div className="flex items-center gap-2">
          {block.filterable ? (
            <input
              className="h-8 rounded-md border border-white/[0.075] bg-[#111111] px-2 text-xs text-zinc-200 outline-none"
              placeholder="Filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          ) : null}
          <CopyButton value={JSON.stringify(block.rows, null, 2)} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-white/[0.035] text-xs text-zinc-500">
            <tr>
              {block.columns.map((column) => (
                <th key={column.key} className="whitespace-nowrap px-3 py-2">
                  <button
                    className="inline-flex items-center gap-1"
                    onClick={() => {
                      setSortKey(column.key);
                      setDirection(sortKey === column.key && direction === "asc" ? "desc" : "asc");
                    }}
                  >
                    {column.label}
                    <ChevronDown className={cn("h-3 w-3 transition", sortKey === column.key && direction === "desc" && "rotate-180")} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-white/[0.055] text-zinc-300">
                {block.columns.map((column) => (
                  <td key={column.key} className="whitespace-nowrap px-3 py-2">{String(row[column.key] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartBlock({ block }: { block: Extract<RichBlock, { type: "chart" }> }) {
  const suffix = block.series[0]?.valueSuffix ?? "";
  const tooltip = <Tooltip contentStyle={{ background: "#151516", border: "1px solid rgba(255,255,255,.09)", borderRadius: 8, color: "#f4f4f5" }} formatter={(value) => `${value}${suffix}`} />;
  return (
    <div className="rounded-lg border border-white/[0.075] bg-[#151516] p-3">
      {block.title ? <div className="mb-3 text-sm font-medium text-zinc-100">{block.title}</div> : null}
      <div className="h-72">
        <ResponsiveContainer>
          {block.chartType === "line" ? (
            <LineChart data={block.data}>
              <CartesianGrid stroke="rgba(255,255,255,.075)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey={block.xKey} stroke="#71717a" />
              <YAxis stroke="#71717a" />
              {tooltip}
              {block.series.map((series, index) => <Line key={series.dataKey} type="monotone" dataKey={series.dataKey} name={series.label} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} />)}
            </LineChart>
          ) : block.chartType === "bar" ? (
            <BarChart data={block.data}>
              <CartesianGrid stroke="rgba(255,255,255,.075)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey={block.xKey} stroke="#71717a" />
              <YAxis stroke="#71717a" />
              {tooltip}
              {block.series.map((series, index) => <Bar key={series.dataKey} dataKey={series.dataKey} name={series.label} fill={colors[index % colors.length]} radius={[5, 5, 0, 0]} />)}
            </BarChart>
          ) : block.chartType === "scatter" ? (
            <ScatterChart>
              <CartesianGrid stroke="rgba(255,255,255,.075)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey={block.xKey ?? "x"} stroke="#71717a" />
              <YAxis dataKey={block.series[0]?.dataKey ?? "y"} stroke="#71717a" />
              {tooltip}
              <Scatter data={block.data} fill={colors[0]} />
            </ScatterChart>
          ) : (
            <PieChart>
              {tooltip}
              <Pie data={block.data} dataKey={block.series[0]?.dataKey ?? "value"} nameKey={block.xKey ?? "name"} outerRadius={95}>
                {block.data.map((_, index) => <Cell key={index} fill={colors[index % colors.length]} />)}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function FunctionPlotBlock({ block }: { block: Extract<RichBlock, { type: "function_plot" }> }) {
  const data = block.points ?? [];
  return (
    <div className="rounded-lg border border-white/[0.075] bg-[#151516] p-3">
      <div className="mb-3 text-sm font-medium text-zinc-100">{block.title ?? block.expression}</div>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke="rgba(255,255,255,.075)" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="x" stroke="#71717a" />
            <YAxis stroke="#71717a" />
            <Tooltip contentStyle={{ background: "#151516", border: "1px solid rgba(255,255,255,.09)", borderRadius: 8, color: "#f4f4f5" }} />
            <Line type="monotone" dataKey="y" stroke="#4ec85a" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function LegacyBlock({ block }: { block: Record<string, unknown> }) {
  const content = typeof block.content === "string" ? block.content : JSON.stringify(block, null, 2);
  const type = typeof block.type === "string" ? block.type : "unknown";
  return (
    <div className="rounded-lg border border-white/[0.075] bg-[#151516] p-3">
      <div className="mb-2 text-xs text-zinc-500">{type === "html" ? "Legacy HTML block shown as code" : `Unsupported block: ${type}`}</div>
      <CodeBlock language={type === "html" ? "html" : "json"} content={content} />
    </div>
  );
}

function ThinkingDisclosure({ content, live = false, placeholder = false }: { content?: string; live?: boolean; placeholder?: boolean }) {
  const [open, setOpen] = useState(live);
  const hasContent = Boolean(content?.trim());
  if (!hasContent && !placeholder) return null;
  return (
    <div className={cn("rounded-lg border bg-[#171718]", open ? "border-white/[0.22]" : "border-white/[0.075]")}>
      <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-[#8b8d98] transition hover:text-zinc-200" onClick={() => setOpen(!open)}>
        <span className="inline-flex min-w-0 items-center gap-2">
          <BrainCircuit className={cn("h-4 w-4", live && "animate-pulse text-zinc-300")} />
          <span className="font-medium">{live ? "Thought Process..." : "Thought Process"}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition", open && "rotate-180")} />
      </button>
      {open && hasContent ? <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-white/[0.07] px-3 py-2 text-xs leading-5 text-[#8b8d98]">{content}</div> : null}
    </div>
  );
}

function RichBlockView({ block }: { block: RichBlock }) {
  if (block.type === "markdown") return <MarkdownBlock content={typeof block.content === "string" ? block.content : ""} />;
  if (block.type === "code") {
    return (
      <CodeBlock
        language={typeof block.language === "string" ? block.language : undefined}
        filename={typeof block.filename === "string" ? block.filename : undefined}
        content={typeof block.content === "string" ? block.content : ""}
      />
    );
  }
  if (block.type === "table") return <TableBlock block={block as Extract<RichBlock, { type: "table" }>} />;
  if (block.type === "chart") return <ChartBlock block={block as Extract<RichBlock, { type: "chart" }>} />;
  if (block.type === "function_plot") return <FunctionPlotBlock block={block as Extract<RichBlock, { type: "function_plot" }>} />;
  if (block.type === "math") return <div className="overflow-x-auto rounded-lg border border-white/[0.075] bg-[#151516] p-3"><BlockMath math={String(block.content ?? "")} /></div>;
  if (block.type === "html") return <LegacyBlock block={block as Record<string, unknown>} />;
  if (block.type === "error") {
    const message = typeof block.message === "string" ? block.message : "Unknown rich block error";
    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes("rich content block") || normalizedMessage.includes("rich_blocks")) return null;
    return <div className="rounded-lg border border-[#ff5c7a]/25 bg-[#ff5c7a]/10 p-3 text-sm text-[#ffb6c4]">{message}</div>;
  }
  if (block.type === "status") return <div className="rounded-lg border border-white/[0.075] bg-white/[0.025] p-3 text-sm text-zinc-400">{String(block.content ?? block.status)}</div>;
  if (block.type === "tool_call" || block.type === "tool_result") return <CodeBlock language="json" content={JSON.stringify(block, null, 2)} />;
  return <LegacyBlock block={block as Record<string, unknown>} />;
}

function isReadyOutput(output: Record<string, unknown> | undefined) {
  return output && Object.keys(output).length === 1 && output.status === "ready";
}

function stepLabel(step: ChatStep) {
  if (step.name === "Thinking/Planning" || step.name === "Finalizing") return "Run initialized";
  if (step.name === "Model response" || step.name === "Provider response") return "Provider call";
  const labels: Record<string, string> = {
    gateway_model_list: "Read model list",
    gateway_latency_comparison: "Compare latency",
    gateway_provider_status: "Check providers",
    gateway_recent_errors: "Read recent errors",
    gateway_fallback_routes: "Read fallback routes",
    gateway_api_key_overview: "Read API key overview",
    gateway_logs_summary: "Summarize logs",
    web_search: "Search web"
  };
  return labels[step.name] ?? step.name;
}

function isTrivialStep(step: ChatStep) {
  return step.type === "status" && (isReadyOutput(step.output) || stepLabel(step) === "Run initialized");
}

function durationLabel(value: number | null | undefined) {
  if (!value) return "";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value} ms`;
}

function activitySummary(run: ChatRun | undefined, steps: ChatStep[]) {
  const relSteps = steps.filter((step) => !isTrivialStep(step));
  const relCount = relSteps.length;
  const relLatency = relSteps.reduce((total, step) => total + (step.latencyMs ?? 0), 0);
  const runLatency = run?.latencyMs ?? (relLatency || null);
  const duration = durationLabel(runLatency);
  if (relCount === 1) return `Activity - ${stepLabel(relSteps[0]!)}${duration ? ` - ${duration}` : ""}`;
  if (relCount > 1) return `Activity - ${relCount} steps${duration ? ` - ${duration}` : ""}`;
  return `Activity${duration ? ` - ${duration}` : ""}`;
}

function ActivityDisclosure({ run, steps }: { run?: ChatRun; steps: ChatStep[] }) {
  const [open, setOpen] = useState(false);
  const relevantSteps = steps.filter((step) => !isTrivialStep(step));
  if (!relevantSteps.length && !run) return null;

  return (
    <div className="pt-1">
      <button className="inline-flex items-center gap-1.5 rounded-md py-1 text-xs text-[#8b8d98] transition hover:text-zinc-300" onClick={() => setOpen(!open)}>
        <span>{activitySummary(run, relevantSteps)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-white/[0.07] bg-[#151516] p-2">
          {run ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-zinc-500">
              <span>{run.status}</span>
              <span>{run.modelAlias}</span>
              {run.provider ? <span>{run.provider}</span> : null}
              {run.latencyMs ? <span>{run.latencyMs} ms</span> : null}
              {run.inputTokens ? <span>in {formatNumber(run.inputTokens)}</span> : null}
              {run.outputTokens ? <span>out {formatNumber(run.outputTokens)}</span> : null}
              {run.estimatedCost ? <span>${run.estimatedCost.toFixed(4)}</span> : null}
            </div>
          ) : null}
          {steps.map((step) => {
            const output = step.output ?? {};
            const sources = Array.isArray((output as any).sources) ? (output as any).sources as Array<{ title: string; url: string }> : [];
            return (
              <details key={step.id} className="rounded-md border border-white/[0.055] bg-white/[0.018]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-left">
                  <span className="flex min-w-0 items-center gap-2 text-xs">
                    <span className={cn("h-1.5 w-1.5 rounded-full", step.status === "completed" ? "bg-[#3ddc97]" : step.status === "failed" ? "bg-[#ff5c7a]" : "bg-[#f4c84a]")} />
                    <span className="truncate text-zinc-300">{stepLabel(step)}</span>
                    <span className="text-zinc-600">{step.status}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-600">{step.latencyMs ? `${step.latencyMs} ms` : step.type}</span>
                </summary>
                <div className="space-y-3 border-t border-white/[0.05] p-3 text-xs text-zinc-400">
                  {"summary" in output ? <div className="whitespace-pre-wrap">{String((output as any).summary).slice(0, 1000)}</div> : null}
                  {sources.length ? (
                    <div className="flex flex-wrap gap-2">
                      {sources.map((source) => (
                        <a key={source.url} className="rounded-md border border-white/[0.08] px-2 py-1 text-[#58b9ff]" href={source.url} target="_blank" rel="noreferrer">
                          {source.title}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid gap-3 lg:grid-cols-2">
                    <CodeBlock language="json" filename="input" content={JSON.stringify(step.input ?? {}, null, 2)} />
                    <CodeBlock language="json" filename="output" content={JSON.stringify(output, null, 2)} />
                  </div>
                </div>
              </details>
            );
          })}
          {!steps.length ? <div className="px-1 text-xs text-zinc-500">No detailed steps recorded.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function MessageView({ message, run, steps, onRegenerate }: { message: ChatMessage; run?: ChatRun; steps: ChatStep[]; onRegenerate: () => void }) {
  const blocks = message.contentBlocks?.blocks?.length ? message.contentBlocks.blocks : [{ type: "markdown", content: message.contentText } as RichBlock];
  const metadata = message.metadata ?? {};
  const reasoningText = typeof metadata.reasoningText === "string" ? metadata.reasoningText : "";
  return (
    <div className={cn("flex py-7", message.role === "user" ? "justify-end" : "justify-start")}>
      {message.role === "assistant" ? (
        <div className="w-full max-w-[850px] space-y-3">
          <ThinkingDisclosure content={reasoningText} />
          <div className="space-y-4 text-[15px] leading-7 text-zinc-100">
            {blocks.map((block, index) => <RichBlockView key={index} block={block} />)}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#8b8d98]">
            <CopyButton value={message.contentText} />
            <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200" onClick={onRegenerate}>
              <RotateCcw className="h-3.5 w-3.5" /> Regenerate
            </button>
            {message.modelAlias ? <span>{message.modelAlias}</span> : null}
            {message.provider ? <span>{message.provider}</span> : null}
            <span>{formatDate(message.createdAt)}</span>
            {typeof metadata.totalTokens === "number" ? <span>{formatNumber(metadata.totalTokens)} tokens</span> : null}
          </div>
          <ActivityDisclosure run={run} steps={steps} />
        </div>
      ) : (
        <div className="max-w-[min(760px,86%)] rounded-xl bg-[#2a2a2e] px-4 py-2.5 text-sm leading-6 text-zinc-100">
          <div className="whitespace-pre-wrap">{message.contentText}</div>
        </div>
      )}
    </div>
  );
}

function defaultModel(models: ChatModel[]) {
  const available = models.filter((model) => model.status !== "failed");
  return available.find((model) => model.alias === "glm5.1")?.alias ?? available[0]?.alias ?? models[0]?.alias ?? "";
}

function ModelPicker({ models, value, onChange }: { models: ChatModel[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const active = models.find((model) => model.alias === value);
  const sorted = [...models].sort((left, right) => {
    if (left.status === "failed" && right.status !== "failed") return 1;
    if (left.status !== "failed" && right.status === "failed") return -1;
    return left.alias.localeCompare(right.alias);
  });

  function dot(status: ModelStatus) {
    if (status === "verified") return "bg-[#3ddc97]";
    if (status === "failed") return "bg-[#ff5c7a]";
    return "bg-[#f4c84a]";
  }

  return (
    <div className="relative">
      <button
        className="flex h-9 max-w-[15rem] items-center gap-2 rounded-lg border border-white/[0.08] bg-[#151515] px-3 text-left text-sm text-zinc-100 transition hover:bg-white/[0.04]"
        onClick={() => setOpen(!open)}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-zinc-500" />
        <span className="min-w-0 truncate">{active?.alias ?? "Select model"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-500 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Close model picker" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/[0.08] bg-[#111113] shadow-2xl shadow-black/50">
            <div className="border-b border-white/[0.06] px-3 py-2">
              <div className="text-sm font-medium text-zinc-100">Model</div>
              <div className="text-xs text-zinc-500">Choose a model for this chat.</div>
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              {sorted.map((model) => {
                const disabled = model.status === "failed";
                const selected = model.alias === value;
                return (
                  <button
                    key={model.alias}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition",
                      selected ? "bg-[#222226] text-zinc-100" : "text-zinc-300 hover:bg-white/[0.04]",
                      disabled && "cursor-not-allowed opacity-50 hover:bg-transparent"
                    )}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      onChange(model.alias);
                      setOpen(false);
                    }}
                  >
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot(model.status))} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{model.alias}</span>
                        {selected ? <Check className="h-4 w-4 shrink-0 text-[#3ddc97]" /> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">
                        {model.provider} / {model.realModel}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-600">
                        <span>{model.status}</span>
                        {model.latencyMs ? <span>{model.latencyMs} ms</span> : null}
                        {model.fallbackCount ? <span>{model.fallbackCount} fallback</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!sorted.length ? <div className="px-3 py-8 text-center text-sm text-zinc-500">No enabled models found.</div> : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function ChatPageClient({ initialModels }: { initialModels: ChatModel[] }) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runs, setRuns] = useState<ChatRun[]>([]);
  const [steps, setSteps] = useState<ChatStep[]>([]);
  const [models, setModels] = useState<ChatModel[]>(initialModels);
  const [tools, setTools] = useState<ChatTool[]>([]);
  const [modelAlias, setModelAlias] = useState(defaultModel(initialModels));
  const [content, setContent] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [runningThreadId, setRunningThreadId] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(true);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("");
  const [openThreadMenu, setOpenThreadMenu] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const scrollRef = useAutoScroll([messages, streamingText, streamingReasoning, steps]);

  const webSearchAvailable = tools.some((tool) => tool.name === "web_search" && tool.enabled);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  async function loadThreads() {
    const result = await apiFetch<{ data: ThreadRow[] }>("/admin/chat/threads");
    setThreads(result.data);
    if (!activeThreadId && !messages.length && result.data[0]) {
      await loadThread(result.data[0].id);
    }
  }

  async function loadModels() {
    setModels(initialModels);
    setModelAlias((current) => current || defaultModel(initialModels));
    testConfiguredModels(initialModels).catch(() => undefined);

    try {
      const result = await apiFetch<{ data: ChatModel[] }>("/admin/chat/models");
      if (result.data.length) {
        setModels(result.data);
        setModelAlias((current) => current || defaultModel(result.data));
      }
    } catch {
      // The chat API can be unavailable while the older API process is still running.
    }
  }

  async function testConfiguredModels(candidates: ChatModel[]) {
    const tested: Array<ChatModel | null> = await Promise.all(
      candidates.map(async (model) => {
        try {
          const response = await fetch(`${API_BASE_URL}/admin/models/test`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alias: model.alias })
          });
          if (!response.ok) return null;
          const result = await response.json() as {
            ok?: boolean;
            message?: string;
            latencyMs?: number;
            provider?: string;
            model?: string;
          };
          if (!result.ok) return null;
          return {
            ...model,
            status: "verified" as const,
            statusMessage: result.message ?? "Verified",
            latencyMs: result.latencyMs ?? null,
            provider: result.provider ?? model.provider,
            realModel: result.model ?? model.realModel
          };
        } catch {
          return null;
        }
      })
    );
    const working = tested.filter((model): model is ChatModel => model !== null);
    if (working.length) {
      setModels(working);
      setModelAlias((current) => working.some((model) => model.alias === current) ? current : defaultModel(working));
    }
  }

  async function loadTools() {
    try {
      const result = await apiFetch<{ data: ChatTool[] }>("/admin/chat/tools");
      setTools(result.data);
    } catch {
      setTools([]);
    }
  }

  async function loadThread(threadId: string) {
    const result = await apiFetch<{ data: ThreadPayload }>(`/admin/chat/threads/${threadId}`);
    activeThreadIdRef.current = result.data.thread.id;
    setActiveThreadId(result.data.thread.id);
    setMessages(result.data.messages);
    setRuns(result.data.runs);
    setSteps(result.data.steps);
    setStreamingText("");
    setStreamingReasoning("");
    setError("");
    setMobileHistoryOpen(false);
  }

  function resetChat() {
    activeThreadIdRef.current = null;
    setActiveThreadId(null);
    setMessages([]);
    setRuns([]);
    setSteps([]);
    setStreamingText("");
    setStreamingReasoning("");
    setContent("");
    setError("");
    setOpenThreadMenu(null);
    setRenamingThreadId(null);
    if (!sessionOpen) setSessionOpen(true);
  }

  async function renameThread(threadId: string, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const result = await apiFetch<{ data: ThreadRow }>(`/admin/chat/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: nextTitle })
    });
    setThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, ...result.data } : thread));
    setRenamingThreadId(null);
    setRenameTitle("");
    setOpenThreadMenu(null);
  }

  async function archiveThread(threadId: string) {
    await apiFetch(`/admin/chat/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true })
    });
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    setOpenThreadMenu(null);
    if (activeThreadId === threadId) resetChat();
  }

  useEffect(() => {
    loadThreads().catch(() => undefined);
    loadModels().catch((err: Error) => setError(err.message));
    loadTools().catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!webSearchAvailable) setWebSearch(false);
  }, [webSearchAvailable]);

  async function sendMessage(regenerate = false, explicitText?: string) {
    const text = explicitText?.trim() || (regenerate ? messages.filter((message) => message.role === "user").at(-1)?.contentText ?? "" : content.trim());
    const requestThreadId = activeThreadId;
    let streamThreadId = requestThreadId;

    function belongsToVisibleThread(threadId?: string | null) {
      if (threadId && !streamThreadId) {
        streamThreadId = threadId;
      }
      const visibleThreadId = activeThreadIdRef.current;
      if (!requestThreadId && !visibleThreadId && streamThreadId) {
        return true;
      }
      return visibleThreadId === streamThreadId || (!visibleThreadId && !streamThreadId);
    }

    if (isRunning) return;
    if (!text) {
      setError("Write a message first.");
      return;
    }
    if (!modelAlias || !models.some((model) => model.alias === modelAlias && model.status !== "failed")) {
      setError("No working model is available for chat.");
      return;
    }
    setError("");
    setContent("");
    setIsRunning(true);
    setRunningThreadId(requestThreadId);
    setStreamingText("");
    setStreamingReasoning("");
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      threadId: requestThreadId ?? "pending",
      role: "user",
      contentText: text,
      contentBlocks: { blocks: [{ type: "markdown", content: text }] },
      modelAlias: null,
      provider: null,
      realModel: null,
      metadata: {},
      createdAt: new Date().toISOString()
    };
    setMessages((current) => [...current, optimisticMessage]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE_URL}/admin/chat/runs/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: requestThreadId ?? undefined, content: text, modelAlias, webSearch }),
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => "");
        const detail = body ? `: ${body.slice(0, 300)}` : "";
        if (response.status === 404) {
          throw new Error("Chat API is not available. Restart the API server so /admin/chat/runs/stream is registered.");
        }
        if (response.status === 401) {
          throw new Error("Admin session expired. Log in again before sending.");
        }
        throw new Error(`Chat request failed (${response.status})${detail}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === "message") {
            const payloadThreadId = typeof payload.message?.threadId === "string" ? payload.message.threadId : null;
            if (!belongsToVisibleThread(payloadThreadId)) continue;
            setMessages((current) => {
              const withoutOptimistic = current.filter((message) => message.id !== optimisticId);
              return withoutOptimistic.some((message) => message.id === payload.message.id) ? withoutOptimistic : [...withoutOptimistic, payload.message];
            });
            activeThreadIdRef.current = payload.message.threadId;
            setRunningThreadId(payload.message.threadId);
            setActiveThreadId(payload.message.threadId);
          }
          if (payload.type === "run") {
            const payloadThreadId = typeof payload.run?.threadId === "string" ? payload.run.threadId : streamThreadId;
            if (!belongsToVisibleThread(payloadThreadId)) continue;
            setRunningThreadId(payloadThreadId ?? null);
            setRuns((current) => [...current.filter((run) => run.id !== payload.run.id), payload.run]);
          }
          if (payload.type === "step") {
            if (!belongsToVisibleThread(streamThreadId)) continue;
            setSteps((current) => [...current.filter((step) => step.id !== payload.step.id), payload.step]);
          }
          if (payload.type === "delta") {
            if (!belongsToVisibleThread(streamThreadId)) continue;
            setStreamingText((current) => current + payload.content);
          }
          if (payload.type === "reasoning_delta") {
            if (!belongsToVisibleThread(streamThreadId)) continue;
            setStreamingReasoning((current) => current + payload.content);
          }
          if (payload.type === "done") {
            const payloadThreadId = typeof payload.message?.threadId === "string" ? payload.message.threadId : streamThreadId;
            if (!belongsToVisibleThread(payloadThreadId)) continue;
            setMessages((current) => [...current.filter((message) => message.id !== payload.message.id), payload.message]);
            setRuns((current) => [...current.filter((run) => run.id !== payload.run.id), payload.run]);
            setStreamingText("");
            setStreamingReasoning("");
          }
          if (payload.type === "error" && belongsToVisibleThread(streamThreadId)) setError(payload.error);
        }
      }
      await loadThreads();
    } catch (err) {
      if (belongsToVisibleThread(streamThreadId)) {
        setMessages((current) => current.filter((message) => message.id !== optimisticId));
        if ((err as Error).name !== "AbortError") setError(err instanceof Error ? err.message : "Chat request failed");
      }
    } finally {
      setIsRunning(false);
      setRunningThreadId(null);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setIsRunning(false);
    setRunningThreadId(null);
  }

  const activeModel = models.find((model) => model.alias === modelAlias);
  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const filteredThreads = threads.filter((thread) => thread.title.toLowerCase().includes(historyFilter.trim().toLowerCase()));
  const runByMessage = new Map(runs.map((run) => [run.id, run]));
  const showRunning = isRunning && activeThreadId === runningThreadId;
  const activeRun = runs.at(-1);
  const visibleRunningSteps = activeRun ? steps.filter((step) => step.runId === activeRun.id) : [];

  return (
    <PageShell flush>
      <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-[#111111]">
        {mobileHistoryOpen ? <button className="fixed inset-0 z-30 bg-black/50 md:hidden" aria-label="Close chats" onClick={() => setMobileHistoryOpen(false)} /> : null}
        <aside
          className={cn(
            "shrink-0 overflow-hidden border-r border-white/[0.045] bg-[#0f0f10] transition-[width,transform] duration-300 ease-out md:relative md:z-auto md:block md:translate-x-0",
            sessionOpen ? "md:w-72" : "md:w-14",
            mobileHistoryOpen ? "fixed inset-y-0 left-0 z-40 w-80 max-w-[86vw] translate-x-0" : "fixed inset-y-0 left-0 z-40 w-80 max-w-[86vw] -translate-x-full md:static"
          )}
        >
          <div className={cn("flex h-full flex-col", !sessionOpen && "md:items-center")}>
            <div className={cn("flex items-center gap-2 p-3", sessionOpen ? "justify-between" : "justify-center")}>
              <Button className={cn("h-10 flex-1 justify-start rounded-lg", !sessionOpen && "hidden")} onClick={resetChat}>
                <Plus className="h-4 w-4" /> New chat
              </Button>
              <Button
                variant="ghost"
                className="hidden h-9 w-9 rounded-lg px-0 md:inline-flex"
                title={sessionOpen ? "Collapse sessions" : "Expand sessions"}
                onClick={() => setSessionOpen(!sessionOpen)}
              >
                {sessionOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" className="h-9 w-9 rounded-lg px-0 md:hidden" onClick={() => setMobileHistoryOpen(false)}><X className="h-4 w-4" /></Button>
            </div>

            {sessionOpen || mobileHistoryOpen ? (
              <>
                <div className="px-3 pb-2">
                  <div className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.06] bg-[#151516] px-3 text-zinc-500">
                    <Search className="h-4 w-4 shrink-0" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
                      placeholder="Search chats"
                      value={historyFilter}
                      suppressHydrationWarning
                      onChange={(event) => setHistoryFilter(event.target.value)}
                    />
                  </div>
                </div>
                <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
                  {filteredThreads.map((thread) => (
                    <div key={thread.id} className="group relative">
                      {renamingThreadId === thread.id ? (
                        <form
                          className="rounded-lg bg-white/[0.04] p-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            renameThread(thread.id, renameTitle).catch((err: Error) => setError(err.message));
                          }}
                        >
                          <input
                            className="h-8 w-full rounded-md border border-white/[0.08] bg-[#151515] px-2 text-sm text-zinc-100 outline-none"
                            value={renameTitle}
                            autoFocus
                            suppressHydrationWarning
                            onChange={(event) => setRenameTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setRenamingThreadId(null);
                                setRenameTitle("");
                              }
                            }}
                          />
                        </form>
                      ) : (
                        <>
                          <button
                            className={cn(
                              "w-full rounded-lg px-3 py-2 pr-9 text-left transition hover:bg-white/[0.04]",
                              activeThreadId === thread.id ? "bg-[#242428] text-zinc-100" : "text-zinc-400"
                            )}
                            onClick={() => loadThread(thread.id).catch((err: Error) => setError(err.message))}
                          >
                            <div className="line-clamp-2 text-sm leading-5">{thread.title}</div>
                            <div className="mt-0.5 text-[11px] text-zinc-600">{formatDate(thread.updatedAt)}</div>
                          </button>
                          <button
                            className="absolute right-1.5 top-1.5 hidden h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-100 group-hover:flex"
                            title="Thread actions"
                            onClick={() => setOpenThreadMenu(openThreadMenu === thread.id ? null : thread.id)}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {openThreadMenu === thread.id ? (
                            <div className="absolute right-1.5 top-9 z-20 w-36 overflow-hidden rounded-lg border border-white/[0.08] bg-[#171719] shadow-2xl shadow-black/40">
                              <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.05]"
                                onClick={() => {
                                  setRenamingThreadId(thread.id);
                                  setRenameTitle(thread.title);
                                  setOpenThreadMenu(null);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Rename
                              </button>
                              <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-white/[0.05]"
                                onClick={() => archiveThread(thread.id).catch((err: Error) => setError(err.message))}
                              >
                                <Archive className="h-3.5 w-3.5" /> Archive
                              </button>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ))}
                  {!filteredThreads.length ? <div className="px-3 py-8 text-center text-sm text-zinc-600">No chats found.</div> : null}
                </div>
              </>
            ) : (
              <div className="hidden space-y-2 px-2 md:block">
                <button className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-100" title="New chat" onClick={resetChat}>
                  <Plus className="h-4 w-4" />
                </button>
                {threads.slice(0, 8).map((thread) => (
                  <button
                    key={thread.id}
                    className={cn("flex h-10 w-10 items-center justify-center rounded-lg text-xs transition hover:bg-white/[0.04]", activeThreadId === thread.id ? "bg-[#242428] text-zinc-100" : "text-zinc-500")}
                    title={thread.title}
                    onClick={() => {
                      setSessionOpen(true);
                      loadThread(thread.id).catch((err: Error) => setError(err.message));
                    }}
                  >
                    {thread.title.trim().slice(0, 1).toUpperCase() || "C"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-white/[0.04] bg-[#111111]/96 px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" className="h-8 w-8 rounded-lg px-0 md:hidden" onClick={() => setMobileHistoryOpen(true)}><Menu className="h-4 w-4" /></Button>
              <Button
                variant="ghost"
                className="hidden h-8 w-8 rounded-lg px-0 md:inline-flex"
                title={sessionOpen ? "Collapse sessions" : "Expand sessions"}
                onClick={() => setSessionOpen(!sessionOpen)}
              >
                {sessionOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              </Button>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-100">{activeThread?.title ?? "GLM-5.1"}</div>
                <div className="truncate text-xs text-zinc-500">{activeModel ? `${activeModel.provider} / ${activeModel.realModel}` : "Choose a model"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ModelPicker models={models} value={modelAlias} onChange={setModelAlias} />
              {webSearchAvailable ? (
                <button
                  className={cn("hidden h-9 items-center gap-2 rounded-lg px-3 text-sm sm:inline-flex", webSearch ? "bg-[#3ddc97]/10 text-[#82efbf]" : "text-zinc-400 hover:bg-white/[0.04]")}
                  onClick={() => setWebSearch(!webSearch)}
                >
                  <Search className="h-4 w-4" /> Search
                </button>
              ) : null}
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6">
            <div className="mx-auto flex min-h-full max-w-[1050px] flex-col">
              {error ? <div className="mt-4 rounded-lg border border-[#ff5c7a]/25 bg-[#ff5c7a]/10 p-3 text-sm text-[#ffb6c4]">{error}</div> : null}
              {!messages.length && !showRunning ? (
                <div className="flex flex-1 flex-col pt-8">
                  <div className="text-lg font-semibold text-zinc-100">GLM-5.1</div>
                  <div className="mt-8 max-w-[850px]">
                    <ThinkingDisclosure placeholder />
                  </div>
                </div>
              ) : null}
              {messages.map((message) => {
                const runId = typeof message.metadata?.runId === "string" ? message.metadata.runId : undefined;
                const messageSteps = runId ? steps.filter((step) => step.runId === runId) : [];
                return (
                  <MessageView
                    key={message.id}
                    message={message}
                    run={runId ? runByMessage.get(runId) : undefined}
                    steps={messageSteps}
                    onRegenerate={() => sendMessage(true).catch((err: Error) => setError(err.message))}
                  />
                );
              })}
              {showRunning ? (
                <div className="flex py-7">
                  <div className="w-full max-w-[850px] space-y-3">
                    <div className="flex items-center gap-2 text-sm text-zinc-500"><Clock3 className="h-4 w-4 animate-pulse" /> Generating...</div>
                    <ThinkingDisclosure content={streamingReasoning} live />
                    {streamingText ? <MarkdownBlock content={streamingText} /> : null}
                    <ActivityDisclosure run={activeRun} steps={visibleRunningSteps} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="sticky bottom-0 bg-[#111111] px-6 pb-5 pt-2">
            <div className="mx-auto max-w-[1050px] rounded-xl border border-white/[0.085] bg-[#18181b] px-3 py-2">
              <textarea
                className="max-h-44 min-h-20 w-full resize-none bg-transparent px-1 py-2 text-sm leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
                placeholder="Send a Message"
                value={content}
                suppressHydrationWarning
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage().catch((err: Error) => setError(err.message));
                  }
                }}
              />
              <div className="flex min-h-10 items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {webSearchAvailable ? (
                    <button
                      className={cn("inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.07] px-2 text-xs transition", webSearch ? "bg-[#3ddc97]/10 text-[#82efbf]" : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100")}
                      onClick={() => setWebSearch(!webSearch)}
                    >
                      <Search className="h-3.5 w-3.5" /> Search
                    </button>
                  ) : null}
                  {isRunning ? <span className="text-xs text-zinc-500">Generating...</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" className="h-9 w-9 rounded-lg px-0" title="Regenerate" disabled={!messages.some((message) => message.role === "user") || isRunning} onClick={() => sendMessage(true)}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  {isRunning ? (
                    <Button variant="secondary" className="h-9 w-24 rounded-lg" onClick={stop}><Square className="h-4 w-4" /> Stop</Button>
                  ) : (
                    <Button className="h-9 w-24 rounded-lg" disabled={!content.trim() || !modelAlias} onClick={() => sendMessage()}>
                      <Send className="h-4 w-4" /> Send
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </PageShell>
  );
}
