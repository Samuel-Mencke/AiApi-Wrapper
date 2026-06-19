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
import { Archive, ArrowLeft, ArrowRight, BrainCircuit, Check, ChevronDown, Copy, Download, Loader2, Menu, Mic, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Paperclip, Pencil, Plus, RotateCcw, Search, Send, Sparkles, Square, Trash2, X } from "lucide-react";

// Minimal typings for the Web Speech API (not in TS DOM lib by default).
interface SpeechRecognitionAlternative { readonly transcript: string; }
interface SpeechRecognitionResult { readonly 0: SpeechRecognitionAlternative; readonly length: number; readonly isFinal: boolean; }
interface SpeechRecognitionResultList { readonly length: number; item(index: number): SpeechRecognitionResult; readonly [index: number]: SpeechRecognitionResult; }
interface SpeechRecognitionEvent extends Event { readonly resultIndex: number; readonly results: SpeechRecognitionResultList; }
interface SpeechRecognitionErrorEvent extends Event { readonly error: string; readonly message: string; }
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
interface SpeechRecognitionConstructor { new (): SpeechRecognition; }
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

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

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
  parentMessageId?: string | null;
  siblingCount?: number;
  siblingIndex?: number;
  attachments?: Attachment[];
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

const colors = ["#7aab5e", "#9ca3af", "#b8b3a8", "#807a6f", "#807a6f", "#807a6f"];

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
      className="inline-flex h-7 items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.025] px-2 text-xs text-[#807a6f] transition hover:bg-white/[0.06] hover:text-[#ece9e4]"
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
    <div className="chat-markdown max-w-none text-[15px] leading-7 text-[#ece9e4]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mb-4 mt-7 text-2xl font-semibold leading-tight text-[#ece9e4] first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-7 text-xl font-semibold leading-tight text-[#ece9e4] first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-6 text-base font-semibold leading-snug text-[#ece9e4] first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-[#ece9e4]">{children}</strong>,
          em: ({ children }) => <em className="text-[#b8b3a8]">{children}</em>,
          blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-white/[0.16] pl-4 text-[#b8b3a8]">{children}</blockquote>,
          hr: () => <hr className="my-7 border-white/[0.07]" />,
          table: ({ children }) => <div className="my-4 overflow-x-auto rounded-lg border border-white/[0.075]"><table className="min-w-full border-collapse text-left text-sm">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-white/[0.035] text-xs text-[#807a6f]">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-white/[0.055]">{children}</tbody>,
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-semibold text-[#b8b3a8]">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 align-top text-[#b8b3a8]">{children}</td>,
          img: ({ alt }) => <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#807a6f]">image blocked{alt ? `: ${alt}` : ""}</span>,
          a: ({ href, children }) => {
            const safe = href?.startsWith("http://") || href?.startsWith("https://");
            return safe ? <a className="text-[#ece9e4] underline decoration-white/30 underline-offset-4 hover:decoration-white/70" href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
          },
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children);
            const language = /language-(\w+)/.exec(className ?? "")?.[1];
            return language ? <CodeBlock language={language} content={text.replace(/\n$/, "")} /> : <code className="rounded bg-white/[0.065] px-1.5 py-0.5 text-[0.9em] text-[#ece9e4]">{children}</code>;
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
    <div className="my-4 overflow-hidden rounded-lg border border-white/[0.075] bg-[#1f1e1c]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.055] px-3 py-2">
        <div className="min-w-0 truncate text-xs text-[#807a6f]">{filename ?? language ?? "code"}</div>
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
    <div className="rounded-lg border border-white/[0.075] bg-[#1f1e1c]">
      <div className="flex flex-col gap-2 border-b border-white/[0.055] p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-[#ece9e4]">{block.title ?? "Table"}</div>
        <div className="flex items-center gap-2">
          {block.filterable ? (
            <input
              className="h-8 rounded-md border border-white/[0.075] bg-[#1a1a19] px-2 text-xs text-[#b8b3a8] outline-none"
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
          <thead className="bg-white/[0.035] text-xs text-[#807a6f]">
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
              <tr key={index} className="border-t border-white/[0.055] text-[#b8b3a8]">
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
  const tooltip = <Tooltip contentStyle={{ background: "#1a1a19", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, color: "#ece9e4" }} formatter={(value) => `${value}${suffix}`} />;
  return (
    <div className="rounded-lg border border-white/[0.075] bg-[#1f1e1c] p-3">
      {block.title ? <div className="mb-3 text-sm font-medium text-[#ece9e4]">{block.title}</div> : null}
      <div className="h-72">
        <ResponsiveContainer>
          {block.chartType === "line" ? (
            <LineChart data={block.data}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey={block.xKey} stroke="#807a6f" />
              <YAxis stroke="#807a6f" />
              {tooltip}
              {block.series.map((series, index) => <Line key={series.dataKey} type="monotone" dataKey={series.dataKey} name={series.label} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} />)}
            </LineChart>
          ) : block.chartType === "bar" ? (
            <BarChart data={block.data}>
              <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey={block.xKey} stroke="#807a6f" />
              <YAxis stroke="#807a6f" />
              {tooltip}
              {block.series.map((series, index) => <Bar key={series.dataKey} dataKey={series.dataKey} name={series.label} fill={colors[index % colors.length]} radius={[5, 5, 0, 0]} />)}
            </BarChart>
          ) : block.chartType === "scatter" ? (
            <ScatterChart>
              <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey={block.xKey ?? "x"} stroke="#807a6f" />
              <YAxis dataKey={block.series[0]?.dataKey ?? "y"} stroke="#807a6f" />
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
    <div className="rounded-lg border border-white/[0.075] bg-[#1f1e1c] p-3">
      <div className="mb-3 text-sm font-medium text-[#ece9e4]">{block.title ?? block.expression}</div>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="x" stroke="#807a6f" />
            <YAxis stroke="#807a6f" />
            <Tooltip contentStyle={{ background: "#1a1a19", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, color: "#ece9e4" }} />
            <Line type="monotone" dataKey="y" stroke="#7aab5e" dot={false} strokeWidth={2} />
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
    <div className="rounded-lg border border-white/[0.075] bg-[#1f1e1c] p-3">
      <div className="mb-2 text-xs text-[#807a6f]">{type === "html" ? "Legacy HTML block shown as code" : `Unsupported block: ${type}`}</div>
      <CodeBlock language={type === "html" ? "html" : "json"} content={content} />
    </div>
  );
}

function ThinkingDisclosure({ content, live = false, placeholder = false }: { content?: string; live?: boolean; placeholder?: boolean }) {
  const [open, setOpen] = useState(live);
  const hasContent = Boolean(content?.trim());
  if (!hasContent && !placeholder) return null;
  return (
    <div className={cn("rounded-lg border bg-[#2a2825]", open ? "border-white/[0.22]" : "border-white/[0.075]")}>
      <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-[#807a6f] transition hover:text-[#b8b3a8]" onClick={() => setOpen(!open)}>
        <span className="inline-flex min-w-0 items-center gap-2">
          <BrainCircuit className={cn("h-4 w-4", live && "animate-pulse text-[#b8b3a8]")} />
          <span className="font-medium">{live ? "Thought Process..." : "Thought Process"}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition", open && "rotate-180")} />
      </button>
      {open && hasContent ? <div className="max-h-72 overflow-y-auto whitespace-pre-wrap border-t border-white/[0.07] px-3 py-2 text-xs leading-5 text-[#807a6f]">{content}</div> : null}
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
  if (block.type === "math") return <div className="overflow-x-auto rounded-lg border border-white/[0.075] bg-[#1f1e1c] p-3"><BlockMath math={String(block.content ?? "")} /></div>;
  if (block.type === "html") return <LegacyBlock block={block as Record<string, unknown>} />;
  if (block.type === "error") {
    const message = typeof block.message === "string" ? block.message : "Unknown rich block error";
    const normalizedMessage = message.toLowerCase();
    if (normalizedMessage.includes("rich content block") || normalizedMessage.includes("rich_blocks")) return null;
    return <div className="rounded-lg border border-[#d65d5d]/25 bg-[#d65d5d]/10 p-3 text-sm text-[#e8a0a0]">{message}</div>;
  }
  if (block.type === "status") return <div className="rounded-lg border border-white/[0.075] bg-white/[0.025] p-3 text-sm text-[#807a6f]">{String(block.content ?? block.status)}</div>;
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
      <button className="inline-flex items-center gap-1.5 rounded-md py-1 text-xs text-[#807a6f] transition hover:text-[#b8b3a8]" onClick={() => setOpen(!open)}>
        <span>{activitySummary(run, relevantSteps)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-white/[0.07] bg-[#1f1e1c] p-2">
          {run ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-[#807a6f]">
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
                    <span className={cn("h-1.5 w-1.5 rounded-full", step.status === "completed" ? "bg-[#7aab5e]" : step.status === "failed" ? "bg-[#d65d5d]" : "bg-[#e0a83e]")} />
                    <span className="truncate text-[#b8b3a8]">{stepLabel(step)}</span>
                    <span className="text-[#5a554d]">{step.status}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[#5a554d]">{step.latencyMs ? `${step.latencyMs} ms` : step.type}</span>
                </summary>
                <div className="space-y-3 border-t border-white/[0.05] p-3 text-xs text-[#807a6f]">
                  {"summary" in output ? <div className="whitespace-pre-wrap">{String((output as any).summary).slice(0, 1000)}</div> : null}
                  {sources.length ? (
                    <div className="flex flex-wrap gap-2">
                      {sources.map((source) => (
                        <a key={source.url} className="rounded-md border border-white/[0.08] px-2 py-1 text-[#6ba4d0]" href={source.url} target="_blank" rel="noreferrer">
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
          {!steps.length ? <div className="px-1 text-xs text-[#807a6f]">No detailed steps recorded.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentThumb({ attachment }: { attachment: Attachment }) {
  if (isImageMime(attachment.mimeType)) {
    return (
      <a
        href={attachmentUrl(attachment.url)}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden rounded-lg border border-white/[0.08] bg-[#1f1e1c]"
        title={attachment.filename}
      >
        <img
          src={attachmentUrl(attachment.url)}
          alt={attachment.filename}
          className="h-28 w-28 object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={attachmentUrl(attachment.url)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#1f1e1c] px-2.5 py-1.5 text-xs text-[#b8b3a8] transition hover:bg-white/[0.04]"
      title={attachment.filename}
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#807a6f]" />
      <span className="max-w-[12rem] truncate">{attachment.filename}</span>
      <span className="text-[#5a554d]">{formatBytes(attachment.size)}</span>
    </a>
  );
}

function SiblingNav({ message, onNavigate }: { message: ChatMessage; onNavigate: () => void }) {
  const count = message.siblingCount ?? 1;
  const index = message.siblingIndex ?? 0;
  if (count <= 1) return null;
  return (
    <span className="inline-flex h-7 items-center gap-0.5 rounded-md border border-white/[0.07] bg-white/[0.025] px-1 text-xs text-[#807a6f]">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#807a6f] transition hover:bg-white/[0.06] hover:text-[#ece9e4] disabled:opacity-30"
        disabled={index <= 0}
        onClick={onNavigate}
        title="Previous sibling"
      >
        <ArrowLeft className="h-3 w-3" />
      </button>
      <span className="min-w-[2rem] text-center tabular-nums">{index + 1}/{count}</span>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-[#807a6f] transition hover:bg-white/[0.06] hover:text-[#ece9e4] disabled:opacity-30"
        disabled={index >= count - 1}
        onClick={onNavigate}
        title="Next sibling"
      >
        <ArrowRight className="h-3 w-3" />
      </button>
    </span>
  );
}

interface MessageViewProps {
  message: ChatMessage;
  run?: ChatRun;
  steps: ChatStep[];
  models: ChatModel[];
  canEdit: boolean;
  onRegenerate: () => void;
  onRegenerateWithModel: (alias: string) => void;
  onEditSave: (text: string) => void;
  onDelete: () => void;
  onNavigateSibling: () => void;
}

function MessageView({
  message,
  run,
  steps,
  models,
  canEdit,
  onRegenerate,
  onRegenerateWithModel,
  onEditSave,
  onDelete,
  onNavigateSibling
}: MessageViewProps) {
  const blocks = message.contentBlocks?.blocks?.length ? message.contentBlocks.blocks : [{ type: "markdown", content: message.contentText } as RichBlock];
  const metadata = message.metadata ?? {};
  const reasoningText = typeof metadata.reasoningText === "string" ? metadata.reasoningText : "";

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(message.contentText);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const attachments = message.attachments ?? [];

  if (message.role === "user") {
    return (
      <div className="group flex justify-end gap-2 py-3">
        <div className="flex max-w-[min(680px,85%)] flex-col items-end gap-1.5">
          {attachments.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-2">
              {attachments.map((attachment) => <AttachmentThumb key={attachment.id} attachment={attachment} />)}
            </div>
          ) : null}
          {isEditing ? (
            <div className="w-full min-w-[18rem] rounded-2xl rounded-br-md border border-white/[0.12] bg-[#2a2825] p-2">
              <textarea
                className="max-h-60 min-h-[3rem] w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-7 text-[#ece9e4] outline-none"
                value={draft}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (draft.trim()) {
                      onEditSave(draft);
                      setIsEditing(false);
                    }
                  }
                  if (event.key === "Escape") {
                    setDraft(message.contentText);
                    setIsEditing(false);
                  }
                }}
              />
              <div className="flex items-center justify-end gap-2 px-1 pb-1 pt-1">
                <button
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#807a6f] transition hover:bg-white/[0.06] hover:text-[#ece9e4]"
                  onClick={() => { setDraft(message.contentText); setIsEditing(false); }}
                >
                  Cancel
                </button>
                <button
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-[#7aab5e] px-3 text-xs font-medium text-[#1a1a19] transition hover:bg-[#8bbf6c] disabled:opacity-50"
                  disabled={!draft.trim()}
                  onClick={() => { onEditSave(draft); setIsEditing(false); }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl rounded-br-md bg-[#2a2825] px-4 py-3 text-[15px] leading-7 text-[#ece9e4]">
              <div className="whitespace-pre-wrap break-words">{message.contentText}</div>
            </div>
          )}
          {!isEditing ? (
            <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs text-[#807a6f]">
              <SiblingNav message={message} onNavigate={onNavigateSibling} />
              <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#807a6f] transition hover:bg-white/[0.04] hover:text-[#ece9e4]" onClick={() => navigator.clipboard.writeText(message.contentText)}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
              {canEdit ? (
                <button
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#807a6f] transition hover:bg-white/[0.04] hover:text-[#ece9e4]"
                  onClick={() => { setDraft(message.contentText); setIsEditing(true); }}
                  title="Edit and branch"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              ) : null}
              {confirmDelete ? (
                <span className="inline-flex h-7 items-center gap-1 rounded-md border border-[#d65d5d]/30 bg-[#d65d5d]/10 px-1.5 text-xs text-[#e8a0a0]">
                  Delete?
                  <button className="rounded px-1.5 font-medium text-[#d65d5d] hover:bg-[#d65d5d]/20" onClick={onDelete}>Yes</button>
                  <button className="rounded px-1.5 text-[#807a6f] hover:bg-white/[0.06]" onClick={() => setConfirmDelete(false)}>No</button>
                </span>
              ) : (
                <button
                  className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#807a6f] transition hover:bg-[#d65d5d]/10 hover:text-[#e8a0a0]"
                  onClick={() => setConfirmDelete(true)}
                  title="Delete message"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="group flex gap-3 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7aab5e]">
        <span className="text-[10px] font-bold text-[#1a1a19]">AI</span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <ThinkingDisclosure content={reasoningText} />
        <div className="space-y-3 text-[15px] leading-7 text-[#ece9e4]">
          {blocks.map((block, index) => <RichBlockView key={index} block={block} />)}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-[#807a6f]">
          <SiblingNav message={message} onNavigate={onNavigateSibling} />
          <CopyButton value={message.contentText} />
          <div className="relative">
            <button
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#807a6f] transition hover:bg-white/[0.04] hover:text-[#ece9e4]"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              title="Regenerate with a different model"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Regenerate with...
            </button>
            {modelMenuOpen ? (
              <>
                <button className="fixed inset-0 z-30 cursor-default" aria-label="Close model menu" onClick={() => setModelMenuOpen(false)} />
                <div className="absolute left-0 z-40 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#232220] p-1 shadow-2xl shadow-black/50">
                  {models.map((model) => (
                    <button
                      key={model.alias}
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-[#b8b3a8] transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={model.status === "failed"}
                      onClick={() => { onRegenerateWithModel(model.alias); setModelMenuOpen(false); }}
                    >
                      <span className="truncate">{model.alias}</span>
                      {model.alias === message.modelAlias ? <Check className="h-3 w-3 shrink-0 text-[#7aab5e]" /> : null}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
          <button className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#807a6f] transition hover:bg-white/[0.04] hover:text-[#ece9e4]" onClick={onRegenerate}>
            <RotateCcw className="h-3.5 w-3.5" /> Regenerate
          </button>
          {confirmDelete ? (
            <span className="inline-flex h-7 items-center gap-1 rounded-md border border-[#d65d5d]/30 bg-[#d65d5d]/10 px-1.5 text-xs text-[#e8a0a0]">
              Delete?
              <button className="rounded px-1.5 font-medium text-[#d65d5d] hover:bg-[#d65d5d]/20" onClick={onDelete}>Yes</button>
              <button className="rounded px-1.5 text-[#807a6f] hover:bg-white/[0.06]" onClick={() => setConfirmDelete(false)}>No</button>
            </span>
          ) : (
            <button
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-[#807a6f] transition hover:bg-[#d65d5d]/10 hover:text-[#e8a0a0]"
              onClick={() => setConfirmDelete(true)}
              title="Delete message"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {message.modelAlias ? <><span>·</span><span>{message.modelAlias}</span></> : null}
          {typeof metadata.totalTokens === "number" ? <><span>·</span><span>{formatNumber(metadata.totalTokens)} tokens</span></> : null}
        </div>
        <ActivityDisclosure run={run} steps={steps} />
      </div>
    </div>
  );
}

function defaultModel(models: ChatModel[]) {
  const available = models.filter((model) => model.status !== "failed");
  return available.find((model) => model.alias === "glm5.2")?.alias ?? available[0]?.alias ?? models[0]?.alias ?? "";
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

// Deterministic pseudo-random based on a numeric seed (mulberry32).
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SuggestionPool {
  category: string;
  items: Array<{ title: string; prompt: string }>;
}

const SUGGESTION_POOLS: SuggestionPool[] = [
  {
    category: "Code",
    items: [
      { title: "Python binary search", prompt: "Write a Python function that implements binary search with type hints" },
      { title: "React useDebounce hook", prompt: "Write a useDebounce hook in TypeScript for React" },
      { title: "SQL schema for users", prompt: "Design a normalized SQL schema for a users + roles system" }
    ]
  },
  {
    category: "Explain",
    items: [
      { title: "How transformers work", prompt: "Explain how transformers work in machine learning, with a simple analogy" },
      { title: "Explain raft consensus", prompt: "Explain the Raft consensus algorithm like I am new to distributed systems" },
      { title: "What is an index?", prompt: "Explain what a database index is and when to use one, with examples" }
    ]
  },
  {
    category: "Analyze",
    items: [
      { title: "API gateway metrics", prompt: "What are the key metrics I should track for an API gateway?" },
      { title: "Compare ORMs", prompt: "Compare Prisma, Drizzle, and Kysely for a TypeScript backend" },
      { title: "Review caching strategies", prompt: "Summarize the main caching strategies and their trade-offs" }
    ]
  },
  {
    category: "Creative",
    items: [
      { title: "Release note draft", prompt: "Write a release note for a new AI gateway dashboard feature" },
      { title: "Product tagline ideas", prompt: "Brainstorm 5 taglines for a developer-focused observability tool" },
      { title: "Onboarding email", prompt: "Draft a friendly onboarding email for new users of an AI platform" }
    ]
  }
];

function buildSuggestions(seed: number) {
  const rand = mulberry32(seed);
  return SUGGESTION_POOLS.map((pool) => {
    const items = [...pool.items];
    // pick 2 unique items per pool
    const picked: Array<{ title: string; prompt: string }> = [];
    while (items.length && picked.length < 2) {
      const idx = Math.floor(rand() * items.length);
      const [item] = items.splice(idx, 1);
      if (item) picked.push(item);
    }
    return picked.map((item) => ({ ...item, category: pool.category }));
  }).flat().slice(0, 4);
}

function greetingForHour(hour: number) {
  if (hour < 5) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Late night";
}

function attachmentUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
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
    if (status === "verified") return "bg-[#7aab5e]";
    if (status === "failed") return "bg-[#d65d5d]";
    return "bg-[#e0a83e]";
  }

  return (
    <div className="relative">
      <button
        className="flex h-9 max-w-[15rem] items-center gap-2 rounded-lg border border-white/[0.08] bg-[#1f1e1c] px-3 text-left text-sm text-[#ece9e4] transition hover:bg-white/[0.04]"
        onClick={() => setOpen(!open)}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-[#807a6f]" />
        <span className="min-w-0 truncate">{active?.alias ?? "Select model"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-[#807a6f] transition", open && "rotate-180")} />
      </button>
      {open ? (
        <>
          <button className="fixed inset-0 z-30 cursor-default" aria-label="Close model picker" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/[0.08] bg-[#232220] shadow-2xl shadow-black/50">
            <div className="border-b border-white/[0.06] px-3 py-2">
              <div className="text-sm font-medium text-[#ece9e4]">Model</div>
              <div className="text-xs text-[#807a6f]">Choose a model for this chat.</div>
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
                      selected ? "bg-[#7aab5e]/8 text-[#ece9e4]" : "text-[#b8b3a8] hover:bg-white/[0.04]",
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
                        {selected ? <Check className="h-4 w-4 shrink-0 text-[#7aab5e]" /> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[#807a6f]">
                        {model.provider} / {model.realModel}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#5a554d]">
                        <span>{model.status}</span>
                        {model.latencyMs ? <span>{model.latencyMs} ms</span> : null}
                        {model.fallbackCount ? <span>{model.fallbackCount} fallback</span> : null}
                      </span>
                    </span>
                  </button>
                );
              })}
              {!sorted.length ? <div className="px-3 py-8 text-center text-sm text-[#807a6f]">No enabled models found.</div> : null}
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
  const [webSearch, setWebSearch] = useState(true);
  const [sessionOpen, setSessionOpen] = useState(true);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const [historyFilter, setHistoryFilter] = useState("");
  const [openThreadMenu, setOpenThreadMenu] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [suggestionSeed, setSuggestionSeed] = useState(() => Date.now() & 0xffffffff);
  const abortRef = useRef<AbortController | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useAutoScroll([messages, streamingText, streamingReasoning, steps]);

  const webSearchAvailable = tools.some((tool) => tool.name === "web_search" && tool.enabled);
  const voiceSupported = typeof window !== "undefined" && Boolean(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );

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
    setAttachments([]);
    setError("");
    setOpenThreadMenu(null);
    setRenamingThreadId(null);
    setSuggestionSeed(Date.now() & 0xffffffff);
    if (isListening) recognitionRef.current?.stop();
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

  // Global keyboard shortcuts.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (mod && event.key === "/") {
        event.preventDefault();
        resetChat();
        return;
      }
      // ArrowUp in empty textarea loads last user message text.
      if (event.key === "ArrowUp" && target?.tagName === "TEXTAREA") {
        const ta = target as HTMLTextAreaElement;
        if (ta.value === "") {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          if (lastUser) {
            event.preventDefault();
            setContent(lastUser.contentText);
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messages]);

  async function sendMessage(regenerate = false, explicitText?: string, options?: { parentMessageId?: string | null; attachments?: Attachment[]; overrideModelAlias?: string }) {
    const effectiveModelAlias = options?.overrideModelAlias ?? modelAlias;
    const effectiveAttachments = options?.attachments ?? attachments;
    const text = explicitText?.trim() || (regenerate ? messages.filter((message) => message.role === "user").at(-1)?.contentText ?? "" : content.trim());
    const requestThreadId = activeThreadId;
    const requestParentMessageId = options?.parentMessageId ?? undefined;
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
    if (!effectiveModelAlias || !models.some((model) => model.alias === effectiveModelAlias && model.status !== "failed")) {
      setError("No working model is available for chat.");
      return;
    }
    setError("");
    setContent("");
    setAttachments([]);
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
      createdAt: new Date().toISOString(),
      parentMessageId: requestParentMessageId ?? null,
      attachments: effectiveAttachments
    };
    setMessages((current) => [...current, optimisticMessage]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE_URL}/admin/chat/runs/stream`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: requestThreadId ?? undefined,
          content: text,
          modelAlias: effectiveModelAlias,
          webSearch,
          parentMessageId: requestParentMessageId,
          attachments: effectiveAttachments
        }),
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

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploadingCount((count) => count + list.length);
    try {
      const results = await Promise.all(
        list.map(async (file) => {
          const formData = new FormData();
          formData.append("file", file);
          const response = await fetch(`${API_BASE_URL}/admin/chat/upload`, {
            method: "POST",
            credentials: "include",
            body: formData
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`Upload failed for ${file.name}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
          }
          const result = await response.json() as { data: Attachment };
          return result.data;
        })
      );
      setAttachments((current) => [...current, ...results]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingCount((count) => Math.max(0, count - list.length));
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function deleteMessage(messageId: string) {
    if (!activeThreadId) return;
    try {
      await apiFetch<{ data: { deleted: number; ids: string[] } }>(`/admin/chat/messages/${messageId}`, {
        method: "DELETE",
        body: JSON.stringify({ cascade: true })
      });
      await loadThread(activeThreadId);
      await loadThreads().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function editMessage(message: ChatMessage, newText: string) {
    const trimmed = newText.trim();
    if (!trimmed || trimmed === message.contentText) return;
    const parent = message.parentMessageId ?? null;
    // Send a new user message as a sibling under the same parent, creating a branch.
    sendMessage(false, trimmed, { parentMessageId: parent, attachments: message.attachments }).catch((err: Error) => setError(err.message));
  }

  function regenerateWithModel(alias: string) {
    sendMessage(true, undefined, { overrideModelAlias: alias }).catch((err: Error) => setError(err.message));
  }

  async function navigateSibling(threadId: string) {
    // Simplified: reload the thread to refresh sibling state from the active path.
    await loadThread(threadId).catch((err: Error) => setError(err.message));
  }

  function toggleVoiceInput() {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    type SpeechWindow = { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const speechWindow = (typeof window !== "undefined" ? (window as unknown as SpeechWindow) : undefined);
    const ctor = speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition;
    if (!ctor) {
      setError("Voice input is not supported in this browser.");
      return;
    }
    const recognition = new ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result) transcript += result[0]?.transcript ?? "";
      }
      if (transcript) {
        setContent((current) => {
          const separator = current && !current.endsWith(" ") ? " " : "";
          return current + separator + transcript.trim();
        });
      }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(`Voice input error: ${event.error}`);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice input failed to start");
    }
  }

  function exportThreadMarkdown() {
    const lines: string[] = [];
    lines.push(`# ${activeThread?.title ?? "Chat Export"}`);
    lines.push("");
    if (activeThread) {
      lines.push(`_Exported ${new Date().toISOString()}_`);
      lines.push("");
    }
    for (const message of messages) {
      if (message.role === "user") {
        lines.push(`## User`);
        lines.push("");
        lines.push(message.contentText);
        lines.push("");
      } else {
        lines.push(`## Assistant (${message.modelAlias ?? "unknown"})`);
        lines.push("");
        lines.push(message.contentText);
        lines.push("");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (activeThread?.title ?? "chat").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 60) || "chat";
    a.download = `${safeName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-[#1a1a19]">
        {/* Mobile thread history overlay */}
        {mobileHistoryOpen ? (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileHistoryOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            "shrink-0 overflow-hidden border-r border-white/[0.05] bg-[#1f1e1c] transition-[width,transform] duration-200 ease-out",
            // Desktop: static column
            "md:relative md:z-auto md:block md:translate-x-0",
            sessionOpen ? "md:w-72" : "md:w-14",
            // Mobile: fixed drawer, slides in from left
            mobileHistoryOpen
              ? "fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] translate-x-0"
              : "fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] -translate-x-full md:static md:translate-x-0"
          )}
        >
          <div className={cn("flex h-full flex-col", !sessionOpen && "md:items-center")}>
            <div className={cn("flex items-center gap-2 p-3", sessionOpen ? "justify-between" : "justify-center")}>
              <Button className={cn("h-10 flex-1 justify-start rounded-lg", !sessionOpen && "hidden md:flex")} onClick={resetChat}>
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
              {mobileHistoryOpen && (
                <Button variant="ghost" className="h-9 w-9 rounded-lg px-0 md:hidden" onClick={() => setMobileHistoryOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {sessionOpen || mobileHistoryOpen ? (
              <>
                <div className="px-3 pb-2">
                  <div className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.06] bg-[#1f1e1c] px-3 text-[#807a6f]">
                    <Search className="h-4 w-4 shrink-0" />
                    <input
                      ref={searchInputRef}
                      className="min-w-0 flex-1 bg-transparent text-sm text-[#b8b3a8] outline-none placeholder:text-[#5a554d]"
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
                            className="h-8 w-full rounded-md border border-white/[0.08] bg-[#1f1e1c] px-2 text-sm text-[#ece9e4] outline-none"
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
                              activeThreadId === thread.id ? "bg-[#7aab5e]/8 text-[#7aab5e]" : "text-[#807a6f]"
                            )}
                            onClick={() => loadThread(thread.id).catch((err: Error) => setError(err.message))}
                          >
                            <div className="line-clamp-2 text-sm leading-5">{thread.title}</div>
                            <div className="mt-0.5 text-[11px] text-[#5a554d]">{formatDate(thread.updatedAt)}</div>
                          </button>
                          <button
                            className="absolute right-1.5 top-1.5 hidden h-7 w-7 items-center justify-center rounded-md text-[#807a6f] transition hover:bg-white/[0.06] hover:text-[#ece9e4] group-hover:flex"
                            title="Thread actions"
                            onClick={() => setOpenThreadMenu(openThreadMenu === thread.id ? null : thread.id)}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {openThreadMenu === thread.id ? (
                            <div className="absolute right-1.5 top-9 z-20 w-36 overflow-hidden rounded-lg border border-white/[0.08] bg-[#2a2825] shadow-2xl shadow-black/40">
                              <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#b8b3a8] hover:bg-white/[0.05]"
                                onClick={() => {
                                  setRenamingThreadId(thread.id);
                                  setRenameTitle(thread.title);
                                  setOpenThreadMenu(null);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" /> Rename
                              </button>
                              <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#b8b3a8] hover:bg-white/[0.05]"
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
                  {!filteredThreads.length ? <div className="px-3 py-8 text-center text-sm text-[#5a554d]">No chats found.</div> : null}
                </div>
              </>
            ) : (
              <div className="hidden space-y-2 px-2 md:block">
                <button className="flex h-10 w-10 items-center justify-center rounded-lg text-[#807a6f] transition hover:bg-white/[0.04] hover:text-[#ece9e4]" title="New chat" onClick={resetChat}>
                  <Plus className="h-4 w-4" />
                </button>
                {threads.slice(0, 8).map((thread) => (
                  <button
                    key={thread.id}
                    className={cn("flex h-10 w-10 items-center justify-center rounded-lg text-xs transition hover:bg-white/[0.04]", activeThreadId === thread.id ? "bg-[#7aab5e]/8 text-[#7aab5e]" : "text-[#807a6f]")}
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
          <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-2 border-b border-white/[0.05] bg-[#1a1a19]/80 px-4 backdrop-blur-sm md:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" className="h-8 w-8 shrink-0 rounded-lg px-0 md:hidden" onClick={() => setMobileHistoryOpen(true)}>
                <Menu className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                className="hidden h-8 w-8 shrink-0 rounded-lg px-0 md:inline-flex"
                title={sessionOpen ? "Collapse sessions" : "Expand sessions"}
                onClick={() => setSessionOpen(!sessionOpen)}
              >
                {sessionOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              </Button>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[#ece9e4]">{activeThread?.title ?? "New Chat"}</div>
                <div className="truncate text-xs text-[#807a6f] hidden sm:block">{activeModel ? `${activeModel.provider} / ${activeModel.realModel}` : "Choose a model"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ModelPicker models={models} value={modelAlias} onChange={setModelAlias} />
              {activeThreadId ? (
                <Button
                  variant="ghost"
                  className="h-9 shrink-0 rounded-lg border border-white/[0.06] px-2.5 text-xs text-[#807a6f] hover:bg-white/[0.04] hover:text-[#ece9e4]"
                  onClick={exportThreadMarkdown}
                  title="Export thread as Markdown"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Export</span>
                </Button>
              ) : null}
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6">
            <div className="mx-auto flex min-h-full max-w-[1050px] flex-col">
              {error ? <div className="mt-4 rounded-lg border border-[#d65d5d]/25 bg-[#d65d5d]/10 p-3 text-sm text-[#e8a0a0]">{error}</div> : null}
              {!messages.length && !showRunning ? (
                <div className="flex flex-1 flex-col items-center justify-center px-4 pt-12">
                  <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-[#ece9e4]">{activeModel?.alias ?? "AI Gateway"}</h2>
                  <p className="mt-2 text-center text-sm text-[#807a6f]">
                    {greetingForHour(new Date().getHours())}. {activeModel ? `${activeModel.provider} / ${activeModel.realModel}` : "Select a model to start"}
                  </p>
                  <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                    {buildSuggestions(suggestionSeed).map((suggestion) => (
                      <button
                        key={`${suggestion.category}-${suggestion.title}`}
                        className="group rounded-xl border border-white/[0.06] bg-[#232220] p-3.5 text-left transition-colors duration-150 hover:border-white/[0.12] hover:bg-[#2a2825]"
                        onClick={() => sendMessage(false, suggestion.prompt).catch((err: Error) => setError(err.message))}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-medium text-[#ece9e4]">{suggestion.title}</div>
                          <span className="shrink-0 rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#5a554d]">{suggestion.category}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-[#807a6f]">{suggestion.prompt}</div>
                      </button>
                    ))}
                  </div>
                  <button
                    className="mt-4 text-xs text-[#5a554d] transition hover:text-[#807a6f]"
                    onClick={() => setSuggestionSeed(Date.now() & 0xffffffff)}
                  >
                    Shuffle suggestions
                  </button>
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
                    models={models}
                    canEdit
                    onRegenerate={() => sendMessage(true).catch((err: Error) => setError(err.message))}
                    onRegenerateWithModel={(alias) => regenerateWithModel(alias)}
                    onEditSave={(text) => editMessage(message, text)}
                    onDelete={() => deleteMessage(message.id).catch((err: Error) => setError(err.message))}
                    onNavigateSibling={() => { if (activeThreadId) navigateSibling(activeThreadId).catch(() => undefined); }}
                  />
                );
              })}
              {showRunning ? (
                <div className="flex gap-3 py-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7aab5e]">
                    <span className="text-[10px] font-bold text-[#1a1a19]">AI</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    {/* Live agent activity indicator */}
                    {visibleRunningSteps.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {visibleRunningSteps.map((step) => (
                          <span
                            key={step.id}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                              step.status === "completed"
                                ? "border-white/[0.06] bg-white/[0.02] text-[#807a6f]"
                                : step.status === "failed"
                                ? "border-[#d65d5d]/20 bg-[#d65d5d]/8 text-[#e08585]"
                                : "border-[#7aab5e]/15 bg-[#7aab5e]/8 text-[#9bc480]"
                            )}
                          >
                            {step.status === "running" && (
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7aab5e]" />
                            )}
                            {step.status === "completed" && <Check className="h-3 w-3" />}
                            {stepLabel(step)}
                            {step.latencyMs ? <span className="text-[#5a554d]">{durationLabel(step.latencyMs)}</span> : null}
                          </span>
                        ))}
                      </div>
                    )}
                    {visibleRunningSteps.length === 0 && (
                      <div className="flex items-center gap-2 text-sm text-[#807a6f]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#7aab5e]" />
                        Thinking...
                      </div>
                    )}
                    <ThinkingDisclosure content={streamingReasoning} live />
                    {streamingText ? (
                      <>
                        <MarkdownBlock content={streamingText} />
                        <span className="inline-block h-4 w-2 translate-y-0.5 animate-pulse rounded-sm bg-[#7aab5e]" />
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div
            className="sticky bottom-0 bg-[#1a1a19] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-6 md:pb-5"
            onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragActive(true); } }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return;
              event.preventDefault();
              setDragActive(false);
              uploadFiles(event.dataTransfer.files).catch((err: Error) => setError(err.message));
            }}
          >
            {dragActive ? (
              <div className="absolute inset-0 z-10 m-2 rounded-xl border-2 border-dashed border-[#7aab5e] bg-[#7aab5e]/10 backdrop-blur-sm" />
            ) : null}
            <div className={cn("mx-auto max-w-[1050px] rounded-xl border bg-[#232220] px-3 py-2 transition-colors focus-within:border-white/[0.14]", dragActive ? "border-[#7aab5e]" : "border-white/[0.07]")}>
              {attachments.length > 0 || uploadingCount > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {attachments.map((attachment) => (
                    <span key={attachment.id} className="group inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#1f1e1c] py-1 pl-2 pr-1 text-xs text-[#b8b3a8]">
                      <Paperclip className="h-3 w-3 text-[#807a6f]" />
                      <span className="max-w-[10rem] truncate">{attachment.filename}</span>
                      <button className="inline-flex h-4 w-4 items-center justify-center rounded text-[#807a6f] transition hover:bg-white/[0.08] hover:text-[#ece9e4]" onClick={() => removeAttachment(attachment.id)}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {uploadingCount > 0 ? <span className="inline-flex items-center gap-1 rounded-lg border border-white/[0.07] bg-[#1f1e1c] px-2 py-1 text-xs text-[#807a6f]"><Loader2 className="h-3 w-3 animate-spin" /> Uploading…</span> : null}
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                className="max-h-44 min-h-[2.5rem] w-full resize-none bg-transparent px-1 py-2 text-sm leading-6 text-[#ece9e4] outline-none placeholder:text-[#807a6f]"
                placeholder="Send a message..."
                value={content}
                suppressHydrationWarning
                onChange={(event) => setContent(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage().catch((err: Error) => setError(err.message));
                  }
                }}
                onPaste={(event) => {
                  const items = event.clipboardData?.items;
                  if (!items) return;
                  const files: File[] = [];
                  const itemList = Array.from(items as unknown as Iterable<DataTransferItem>);
                  for (const item of itemList) {
                    if (item.kind === "file") {
                      const file = item.getAsFile();
                      if (file) files.push(file);
                    }
                  }
                  if (files.length) {
                    event.preventDefault();
                    uploadFiles(files).catch((err: Error) => setError(err.message));
                  }
                }}
              />
              <div className="flex min-h-9 items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,text/*,.pdf,.json,.js,.ts,.py,.zip,.sh,.md"
                    className="hidden"
                    onChange={(event) => { if (event.target.files) uploadFiles(event.target.files).catch((err: Error) => setError(err.message)); event.target.value = ""; }}
                  />
                  <button
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.06] px-2 text-xs text-[#807a6f] transition hover:bg-white/[0.04] hover:text-[#ece9e4]"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                  </button>
                  {webSearchAvailable ? (
                    <button
                      className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.06] px-2 text-xs transition", webSearch ? "bg-[#7aab5e]/10 text-[#9bc480]" : "text-[#807a6f] hover:bg-white/[0.04] hover:text-[#ece9e4]")}
                      onClick={() => setWebSearch(!webSearch)}
                    >
                      <Search className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Search</span>
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  {voiceSupported ? (
                    <button
                      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border text-xs transition", isListening ? "border-[#d65d5d]/30 bg-[#d65d5d]/10 text-[#e8a0a0]" : "border-white/[0.06] text-[#807a6f] hover:bg-white/[0.04] hover:text-[#ece9e4]")}
                      onClick={toggleVoiceInput}
                      title={isListening ? "Stop voice input" : "Start voice input"}
                    >
                      {isListening ? <span className="h-3 w-3 animate-pulse rounded-full bg-[#d65d5d]" /> : <Mic className="h-3.5 w-3.5" />}
                    </button>
                  ) : null}
                  {isRunning ? (
                    <Button variant="secondary" className="h-8 rounded-lg px-3 text-xs" onClick={stop}><Square className="h-3 w-3" /> Stop</Button>
                  ) : (
                    <Button className="h-8 rounded-lg px-3 text-xs" disabled={!content.trim() || !modelAlias} onClick={() => sendMessage()}>
                      <Send className="h-3.5 w-3.5" />
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
