"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { apiFetch } from "@/lib/api";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";

interface UsageAggregate {
  id: string;
  label: string;
  provider?: string;
  modelAlias?: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
  errorRate: number;
}

interface QuotaWindow {
  provider: string;
  modelAlias: string;
  enabled: boolean;
  windowHours: number;
  requests: number;
  totalTokens: number;
  requestLimit: number | null;
  tokenLimit: number | null;
  concurrencyLimit: number | null;
  requestPercent: number | null;
  tokenPercent: number | null;
  resetsAt: string;
}

interface ProviderQuotaStatus {
  provider: string;
  status: string;
  exactProviderResetAt: string | null;
  estimatedFiveHourResetAt: string | null;
  weeklyResetAt: string | null;
  notes: string[];
  lastQuotaEvent: null | {
    createdAt: string;
    modelAlias: string;
    errorCode: string | null;
    errorMessage: string | null;
    estimatedFiveHourResetAt: string | null;
  };
}

interface ModelPerformanceEntry {
  modelAlias: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  averageLatencyMs: number;
  throughput: number;          // output tokens/sec
  costPer1kTokens: number;
  errorRate: number;
  reliability: number;         // 0-1
  scores: {
    throughput: number;
    latency: number;
    cost: number;
    reliability: number;
    volume: number;
    composite: number;
  };
}

interface Stats {
  requestsToday: number;
  requestsLast5h: number;
  totalRequests: number;
  totalTokens: number;
  averageLatencyMs: number;
  errorRate: number;
  estimatedCost: number;
  activeProviders: number;
  requestsOverTime: Array<{
    time: string;
    requests: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    averageLatencyMs: number;
  }>;
  requestsByProviderOverTime: Array<{ time: string; key: string; requests: number; errors: number }>;
  requestsByModelOverTime: Array<{ time: string; key: string; requests: number; errors: number }>;
  requestsByApiKeyOverTime: Array<{ time: string; key: string; requests: number; errors: number }>;
  usageByApiKey: UsageAggregate[];
  usageByApiKeyProvider: UsageAggregate[];
  usageByApiKeyModel: UsageAggregate[];
  usageByModel: UsageAggregate[];
  usageByProvider: UsageAggregate[];
  modelPerformance: ModelPerformanceEntry[];
  chatUsage: UsageAggregate;
  quotaWindows: QuotaWindow[];
  topStats: {
    mostUsedModel: UsageAggregate | null;
    costliestProvider: UsageAggregate | null;
    slowestProvider: UsageAggregate | null;
    highestErrorSource: UsageAggregate | null;
  };
}

type ChartPoint = Record<string, string | number>;

type TooltipPayloadItem = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
};

const colors = ["#7aab5e", "#e0a83e", "#d65d5d", "#6ba4d0", "#d66dff", "#71e3e8", "#f58d49", "#b8b3a8"];
const chartModes = [
  { id: "total", label: "Total" },
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
  { id: "apiKey", label: "API key" }
] as const;

type ChartMode = (typeof chartModes)[number]["id"];
const chartBucketCount = 24;

const chartAxis = {
  stroke: "#807a6f",
  tick: { fill: "#807a6f", fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: "rgba(255,255,255,.08)" }
};

function usd(value: number) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function percent(value: number | null) {
  if (value === null) return "No limit";
  return `${Math.round(value * 100)}%`;
}

function formatTime(value: string | number) {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortLabel(value: string | number) {
  const label = String(value);
  return label.length > 12 ? `${label.slice(0, 10)}...` : label;
}

function hourBucket(date: Date) {
  return date.toISOString().slice(0, 13) + ":00";
}

function recentHourBuckets(count = chartBucketCount) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setHours(now.getHours() - (count - 1 - index));
    return hourBucket(date);
  });
}

function normalizeTotalSeries(rows: Stats["requestsOverTime"]) {
  const buckets = recentHourBuckets();
  const byTime = new Map(rows.map((row) => [row.time, row]));
  return buckets.map((time) => ({
    time,
    requests: byTime.get(time)?.requests ?? 0,
    errors: byTime.get(time)?.errors ?? 0,
    inputTokens: byTime.get(time)?.inputTokens ?? 0,
    outputTokens: byTime.get(time)?.outputTokens ?? 0,
    totalTokens: byTime.get(time)?.totalTokens ?? 0,
    estimatedCost: byTime.get(time)?.estimatedCost ?? 0,
    averageLatencyMs: byTime.get(time)?.averageLatencyMs ?? 0
  }));
}

function pivotSeries(rows: Array<{ time: string; key: string; requests: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.key, (totals.get(row.key) ?? 0) + row.requests);
  }

  const keys = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .slice(0, 8);
  const buckets = recentHourBuckets();
  const byTime = new Map<string, Record<string, string | number>>();
  for (const time of buckets) {
    byTime.set(time, Object.fromEntries([["time", time], ...keys.map((key) => [key, 0])]));
  }

  for (const row of rows) {
    const bucket = byTime.get(row.time);
    if (bucket && keys.includes(row.key)) {
      bucket[row.key] = ((bucket[row.key] as number | undefined) ?? 0) + row.requests;
    }
  }
  return { data: buckets.map((time) => byTime.get(time) ?? { time }), keys };
}

function groupedUsage(rows: UsageAggregate[], mode: "provider" | "modelAlias") {
  const dimensions = Array.from(new Set(rows.map((row) => row[mode]).filter(Boolean) as string[])).slice(0, 8);
  const byKey = new Map<string, Record<string, string | number>>();
  for (const row of rows) {
    const bucket = byKey.get(row.label) ?? { label: row.label };
    const dimension = row[mode];
    if (dimension && dimensions.includes(dimension)) {
      bucket[dimension] = ((bucket[dimension] as number | undefined) ?? 0) + row.totalTokens;
    }
    byKey.set(row.label, bucket);
  }
  return { data: Array.from(byKey.values()), keys: dimensions };
}

function sparklineFrom(rows: Stats["requestsOverTime"], key: "requests" | "errors" | "totalTokens" | "averageLatencyMs" | "estimatedCost") {
  return normalizeTotalSeries(rows)
    .slice(-18)
    .map((row, index) => ({ value: row[key], index }));
}

function errorRateSparkline(rows: Stats["requestsOverTime"]) {
  return normalizeTotalSeries(rows)
    .slice(-18)
    .map((row, index) => ({
      value: row.requests ? Math.round((row.errors / row.requests) * 100) : 0,
      index
    }));
}

function keyedRequestSparkline(rows: Stats["requestsByModelOverTime"], key?: string) {
  const buckets = recentHourBuckets().slice(-18);
  const values = new Map<string, number>();
  if (key) {
    for (const row of rows) {
      if (row.key === key) values.set(row.time, (values.get(row.time) ?? 0) + row.requests);
    }
  }
  return buckets.map((time, index) => ({ value: values.get(time) ?? 0, index }));
}

function DashboardTooltip({ active, label, payload }: { active?: boolean; label?: string | number; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border border-white/[0.08] bg-[#232220]/95 px-3 py-2 shadow-2xl shadow-black/40">
      <div className="mb-2 text-xs text-[#807a6f]">{label ? formatTime(label) : "Metric"}</div>
      <div className="space-y-1.5">
        {payload.map((item) => (
          <div key={`${item.dataKey ?? item.name}`} className="flex items-center justify-between gap-5 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-[#807a6f]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color ?? "#b8b3a8" }} />
              <span className="truncate">{item.name ?? item.dataKey}</span>
            </span>
            <span className="font-medium text-[#ece9e4]">{typeof item.value === "number" ? formatNumber(item.value) : item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineLegend({ keys }: { keys: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      {keys.map((key, index) => (
        <div key={key} className="flex items-center gap-2 text-xs text-[#807a6f]">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[index % colors.length] }} />
          <span className="max-w-28 truncate">{key}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-[#1f1e1c] text-sm text-[#807a6f]">
      {label}
    </div>
  );
}

function MiniSparkline({ data, color }: { data: Array<{ value: number; index: number }>; color: string }) {
  const width = 220;
  const height = 46;
  const padding = 4;
  const values = data.length ? data.map((point) => point.value) : [0, 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2);
    const y = range === 0 ? height - padding : height - padding - ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");

  return (
    <svg className="h-12 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden="true">
      <path d={`M ${padding} ${height - padding} L ${width - padding} ${height - padding}`} fill="none" stroke="rgba(255,255,255,.08)" />
      <path d={linePath} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function QuotaMeter({ label, used, limit, value }: { label: string; used: number; limit: number | null; value: number | null }) {
  const width = value === null ? 0 : Math.min(value * 100, 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-[#807a6f]">{label}</span>
        <span className="shrink-0 text-[#b8b3a8]">
          {formatNumber(used)} {limit ? `/ ${formatNumber(limit)}` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#7aab5e]/8">
        <div
          className={cn("h-full rounded-full", value !== null && value > 0.85 ? "bg-[#e0a83e]" : "bg-[#7aab5e]")}
          style={{ width: `${limit ? width : 12}%` }}
        />
      </div>
      <div className="text-xs text-[#807a6f]">{percent(value)}</div>
    </div>
  );
}

function scoreColor(score: number) {
  if (score >= 75) return "#7aab5e";   // green
  if (score >= 50) return "#e0a83e";   // amber
  if (score >= 25) return "#f58d49";   // orange
  return "#d65d5d";                     // red
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-[#807a6f]">
        <span>{label}</span>
        <span className="font-medium text-[#b8b3a8]">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#262629]">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: scoreColor(value) }} />
      </div>
    </div>
  );
}

function ModelPerformancePanel({ entries }: { entries: ModelPerformanceEntry[] }) {
  if (!entries.length) return null;
  const top = entries[0]!;

  return (
    <Card className="bg-[#232220]">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Model Performance Ranking</CardTitle>
          <p className="mt-1 text-xs text-[#807a6f]">Composite score aus Speed, Tokens/s, Zuverlaessigkeit, Kosten & Volume.</p>
        </div>
        <Badge className="border-[#7aab5e]/25 bg-[#7aab5e]/10 text-[#9bc480]">
          #1 {top.modelAlias}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Header row */}
        <div className="hidden grid-cols-[1.5fr_0.7fr_0.8fr_0.7fr_0.8fr_2fr] gap-3 border-b border-white/[0.06] px-2 pb-2 text-[10px] uppercase tracking-wide text-[#807a6f] sm:grid">
          <span>Model</span>
          <span className="text-right">Tokens/s</span>
          <span className="text-right">Latency</span>
          <span className="text-right">Error %</span>
          <span className="text-right">Requests</span>
          <span className="text-center">Score Breakdown</span>
        </div>

        {entries.map((entry, index) => {
          const s = entry.scores;
          return (
            <div
              key={entry.modelAlias}
              className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.05] bg-[#1f1e1c] p-3 sm:grid-cols-[1.5fr_0.7fr_0.8fr_0.7fr_0.8fr_2fr] sm:items-center sm:gap-3"
            >
              {/* Rank + Model */}
              <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold"
                  style={{ background: index === 0 ? "#7aab5e20" : "#ffffff08", color: index === 0 ? "#9bc480" : "#807a6f" }}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[#ece9e4]">{entry.modelAlias}</div>
                  <div className="text-[10px] text-[#807a6f]">{entry.provider}</div>
                </div>
              </div>

              {/* Tokens/sec */}
              <div className="text-right">
                <div className="text-[10px] text-[#807a6f] sm:hidden">Tokens/s</div>
                <div className="text-sm font-medium text-[#ece9e4]">{entry.throughput.toFixed(1)}</div>
              </div>

              {/* Latency */}
              <div className="text-right">
                <div className="text-[10px] text-[#807a6f] sm:hidden">Latency</div>
                <div className="text-sm font-medium text-[#ece9e4]">{formatNumber(entry.averageLatencyMs)}ms</div>
              </div>

              {/* Error rate */}
              <div className="text-right">
                <div className="text-[10px] text-[#807a6f] sm:hidden">Errors</div>
                <div className="text-sm font-medium" style={{ color: entry.errorRate > 0.1 ? "#d65d5d" : "#ece9e4" }}>
                  {Math.round(entry.errorRate * 100)}%
                </div>
              </div>

              {/* Requests */}
              <div className="text-right">
                <div className="text-[10px] text-[#807a6f] sm:hidden">Requests</div>
                <div className="text-sm font-medium text-[#ece9e4]">{formatNumber(entry.requests)}</div>
              </div>

              {/* Score breakdown */}
              <div className="col-span-2 mt-1 flex items-center gap-3 sm:col-span-1 sm:mt-0">
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: scoreColor(s.composite) }}>{s.composite}</span>
                  <span className="text-[10px] text-[#807a6f]">/100</span>
                </div>
                <div className="grid flex-1 grid-cols-5 gap-1.5">
                  <ScoreBar label="Speed" value={s.throughput} />
                  <ScoreBar label="Lat" value={s.latency} />
                  <ScoreBar label="Rel" value={s.reliability} />
                  <ScoreBar label="Cost" value={s.cost} />
                  <ScoreBar label="Vol" value={s.volume} />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TopUsagePanel({ title, rows, metric }: { title: string; rows: UsageAggregate[]; metric: "requests" | "tokens" | "latency" }) {
  const topRows = rows.slice(0, 6);
  const maxValue = Math.max(
    1,
    ...topRows.map((row) => (metric === "requests" ? row.requests : metric === "tokens" ? row.totalTokens : row.averageLatencyMs))
  );

  function valueFor(row: UsageAggregate) {
    if (metric === "requests") return row.requests;
    if (metric === "tokens") return row.totalTokens;
    return row.averageLatencyMs;
  }

  function formattedValue(row: UsageAggregate) {
    if (metric === "latency") return `${formatNumber(valueFor(row))} ms`;
    return formatNumber(valueFor(row));
  }

  return (
    <Card className="bg-[#232220]">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        <span className="text-xs text-[#807a6f]">{topRows.length ? "Top 6" : "No data"}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        {topRows.map((row, index) => {
          const value = valueFor(row);
          return (
            <div key={row.id} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-[#b8b3a8]">{row.label}</span>
                <span className="shrink-0 font-medium text-[#ece9e4]">{formattedValue(row)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#262629]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(4, (value / maxValue) * 100)}%`,
                    background: colors[index % colors.length]
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-[#807a6f]">
                <span>{row.provider ?? row.modelAlias ?? `${formatNumber(row.errors)} errors`}</span>
                <span>{Math.round(row.errorRate * 100)}% err</span>
              </div>
            </div>
          );
        })}
        {!topRows.length ? <div className="text-sm text-[#807a6f]">No usage yet</div> : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [providerQuota, setProviderQuota] = useState<ProviderQuotaStatus | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("total");
  const [usageMode, setUsageMode] = useState<"provider" | "modelAlias">("provider");
  const [error, setError] = useState("");

  function load() {
    Promise.all([
      apiFetch<Stats>("/admin/stats"),
      apiFetch<ProviderQuotaStatus>("/admin/quota")
    ])
      .then(([statsResult, providerQuotaResult]) => {
        setStats(statsResult);
        setProviderQuota(providerQuotaResult);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  const timeSeries = useMemo(() => {
    if (!stats) return { data: [], keys: [] as string[] };
    if (chartMode === "total") return { data: normalizeTotalSeries(stats.requestsOverTime), keys: ["requests", "errors"] };
    if (chartMode === "provider") return pivotSeries(stats.requestsByProviderOverTime);
    if (chartMode === "model") return pivotSeries(stats.requestsByModelOverTime);
    return pivotSeries(stats.requestsByApiKeyOverTime);
  }, [chartMode, stats]);

  const apiKeyChart = useMemo(() => {
    if (!stats) return { data: [], keys: [] as string[] };
    return groupedUsage(usageMode === "provider" ? stats.usageByApiKeyProvider : stats.usageByApiKeyModel, usageMode);
  }, [stats, usageMode]);

  const statSparklines = useMemo(() => {
    if (!stats) return [];
    return [
      sparklineFrom(stats.requestsOverTime, "requests"),
      sparklineFrom(stats.requestsOverTime, "totalTokens"),
      sparklineFrom(stats.requestsOverTime, "averageLatencyMs"),
      errorRateSparkline(stats.requestsOverTime),
      sparklineFrom(stats.requestsOverTime, "estimatedCost"),
      keyedRequestSparkline(stats.requestsByModelOverTime, stats.topStats.mostUsedModel?.label)
    ];
  }, [stats]);

  if (error) return <div className="text-sm text-[#e08585]">{error}</div>;
  if (!stats) return <div className="text-sm text-[#807a6f]">Loading gateway status...</div>;

  const statCards = [
    {
      label: "Requests today",
      value: formatNumber(stats.requestsToday),
      detail: `${formatNumber(stats.requestsLast5h)} in 5h`,
      color: colors[0] ?? "#7aab5e"
    },
    {
      label: "Total tokens",
      value: formatNumber(stats.totalTokens),
      detail: `${formatNumber(stats.totalRequests)} requests`,
      color: colors[3] ?? "#807a6f"
    },
    {
      label: "Average latency",
      value: `${stats.averageLatencyMs} ms`,
      detail: stats.topStats.slowestProvider ? `${stats.topStats.slowestProvider.label} slowest` : "No latency yet",
      color: colors[1] ?? "#e0a83e"
    },
    {
      label: "Error rate",
      value: `${Math.round(stats.errorRate * 100)}%`,
      detail: stats.topStats.highestErrorSource ? `${stats.topStats.highestErrorSource.label} has most errors` : "No errors",
      color: colors[2] ?? "#d65d5d"
    },
    {
      label: "Estimated cost",
      value: usd(stats.estimatedCost),
      detail: stats.topStats.costliestProvider ? `${stats.topStats.costliestProvider.label} leads` : "No cost yet",
      color: colors[6] ?? "#f58d49"
    },
    {
      label: "Top model",
      value: stats.topStats.mostUsedModel?.label ?? "None",
      detail: `${formatNumber(stats.topStats.mostUsedModel?.requests ?? 0)} requests`,
      color: colors[4] ?? "#b8b3a8"
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#ece9e4]">Overview</h1>
          <p className="mt-1 text-sm text-[#807a6f]">Live gateway metrics from stored request logs.</p>
        </div>
        <Badge className="w-fit border-[#7aab5e]/25 bg-[#7aab5e]/10 text-[#9bc480]">
          {formatNumber(stats.activeProviders)} providers active
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {statCards.map((card, index) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            detail={card.detail}
            accentColor={card.color}
            sparkline={<MiniSparkline data={statSparklines[index] ?? []} color={card.color} />}
          />
        ))}
      </div>

      <Card className="bg-[#232220]">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Z.ai quota</CardTitle>
          <Badge>Renews every 5h</Badge>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-[#ece9e4]">
                {providerQuota?.estimatedFiveHourResetAt
                  ? `Next estimated reset: ${formatDate(providerQuota.estimatedFiveHourResetAt)}`
                  : "Quota renews automatically every 5 hours after usage."}
              </div>
              <div className="mt-1 text-sm text-[#807a6f]">
                {providerQuota?.lastQuotaEvent
                  ? `Last quota issue: ${formatDate(providerQuota.lastQuotaEvent.createdAt)}`
                  : "If requests stop because quota is empty, this card will show the next estimated reset time."}
              </div>
            </div>
            <a
              className="w-fit shrink-0 rounded-lg border border-white/[0.06] bg-[#1f1f22] px-3 py-2 text-sm text-[#b8b3a8] transition hover:bg-white/[0.04] hover:text-[#ece9e4]"
              href="https://z.ai/manage-apikey/subscription"
              target="_blank"
              rel="noreferrer"
            >
              Z.ai usage
            </a>
          </div>
        </CardContent>
      </Card>

      <ModelPerformancePanel entries={stats.modelPerformance ?? []} />

      <Card className="bg-[#232220]">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Dashboard Chat API</CardTitle>
          <Badge>{stats.chatUsage.label}</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <div>
              <div className="text-xs text-[#807a6f]">Requests</div>
              <div className="mt-1 text-lg font-semibold text-[#ece9e4]">{formatNumber(stats.chatUsage.requests)}</div>
            </div>
            <div>
              <div className="text-xs text-[#807a6f]">Input tokens</div>
              <div className="mt-1 text-lg font-semibold text-[#ece9e4]">{formatNumber(stats.chatUsage.inputTokens)}</div>
            </div>
            <div>
              <div className="text-xs text-[#807a6f]">Output tokens</div>
              <div className="mt-1 text-lg font-semibold text-[#ece9e4]">{formatNumber(stats.chatUsage.outputTokens)}</div>
            </div>
            <div>
              <div className="text-xs text-[#807a6f]">Avg latency</div>
              <div className="mt-1 text-lg font-semibold text-[#ece9e4]">{formatNumber(stats.chatUsage.averageLatencyMs)} ms</div>
            </div>
            <div>
              <div className="text-xs text-[#807a6f]">Cost</div>
              <div className="mt-1 text-lg font-semibold text-[#ece9e4]">{usd(stats.chatUsage.estimatedCost)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4">
        <Card className="bg-[#232220]">
          <CardHeader className="flex flex-col gap-4 border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Requests over time</CardTitle>
              <p className="mt-1 text-xs text-[#807a6f]">Hourly buckets from gateway logs.</p>
            </div>
            <div className="flex w-full rounded-lg border border-white/[0.06] bg-[#1f1e1c] p-1 sm:w-auto">
              {chartModes.map((mode) => (
                <Button
                  key={mode.id}
                  variant="ghost"
                  className={cn("h-7 flex-1 rounded-md px-2 text-xs sm:flex-none", chartMode === mode.id && "bg-[#7aab5e]/8 text-[#ece9e4]")}
                  onClick={() => setChartMode(mode.id)}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <InlineLegend keys={timeSeries.keys} />
            <div className="h-[340px] rounded-lg border border-white/[0.07] bg-[#1f1e1c] p-3">
              {timeSeries.data.length ? (
                <ResponsiveContainer>
                  <LineChart data={timeSeries.data as ChartPoint[]} margin={{ top: 12, right: 10, left: -18, bottom: 2 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="time" tickFormatter={formatTime} minTickGap={22} {...chartAxis} />
                    <YAxis {...chartAxis} />
                    <Tooltip content={<DashboardTooltip />} cursor={{ stroke: "rgba(255,255,255,.16)", strokeDasharray: "3 5" }} />
                    {timeSeries.keys.map((key, index) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key}
                        stroke={colors[index % colors.length]}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, stroke: "#0f0f10" }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No request history yet" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#232220]">
          <CardHeader>
            <CardTitle>5h quota windows</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.quotaWindows.map((quota) => (
              <div key={`${quota.provider}:${quota.modelAlias}`} className="space-y-3 rounded-lg border border-white/[0.07] bg-[#1f1e1c] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[#ece9e4]">{quota.modelAlias}</div>
                    <div className="text-xs text-[#807a6f]">{quota.provider} - resets {formatDate(quota.resetsAt)}</div>
                  </div>
                  <Badge className="shrink-0">{quota.windowHours}h</Badge>
                </div>
                <QuotaMeter label="Requests" used={quota.requests} limit={quota.requestLimit} value={quota.requestPercent} />
                <QuotaMeter label="Tokens" used={quota.totalTokens} limit={quota.tokenLimit} value={quota.tokenPercent} />
                {quota.concurrencyLimit ? <div className="text-xs text-[#807a6f]">Concurrency limit: {quota.concurrencyLimit}</div> : null}
              </div>
            ))}
            {!stats.quotaWindows.length ? <div className="text-sm text-[#807a6f]">No quota windows enabled.</div> : null}
          </CardContent>
        </Card>

      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="bg-[#232220] xl:col-span-2">
          <CardHeader className="flex flex-col gap-4 border-b-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>API key usage by {usageMode === "provider" ? "provider" : "model"}</CardTitle>
              <p className="mt-1 text-xs text-[#807a6f]">Stored token usage grouped by key.</p>
            </div>
            <div className="flex w-full rounded-lg border border-white/[0.06] bg-[#1f1e1c] p-1 sm:w-auto">
              <Button
                variant="ghost"
                className={cn("h-7 flex-1 rounded-md px-2 text-xs sm:flex-none", usageMode === "provider" && "bg-[#7aab5e]/8 text-[#ece9e4]")}
                onClick={() => setUsageMode("provider")}
              >
                Provider
              </Button>
              <Button
                variant="ghost"
                className={cn("h-7 flex-1 rounded-md px-2 text-xs sm:flex-none", usageMode === "modelAlias" && "bg-[#7aab5e]/8 text-[#ece9e4]")}
                onClick={() => setUsageMode("modelAlias")}
              >
                Model
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <InlineLegend keys={apiKeyChart.keys} />
            <div className="h-72 rounded-lg border border-white/[0.07] bg-[#1f1e1c] p-3">
              {apiKeyChart.data.length ? (
                <ResponsiveContainer>
                  <BarChart data={apiKeyChart.data as ChartPoint[]} margin={{ top: 12, right: 10, left: -18, bottom: 2 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.08)" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="label" tickFormatter={shortLabel} interval={0} minTickGap={10} {...chartAxis} />
                    <YAxis {...chartAxis} />
                    <Tooltip content={<DashboardTooltip />} cursor={{ fill: "rgba(255,255,255,.035)" }} />
                    {apiKeyChart.keys.map((key, index) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        name={key}
                        stackId="usage"
                        fill={colors[index % colors.length]}
                        radius={index === apiKeyChart.keys.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart label="No API key usage yet" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <TopUsagePanel title="Top API keys" rows={stats.usageByApiKey} metric="requests" />
        <TopUsagePanel title="Top models" rows={stats.usageByModel} metric="tokens" />
        <TopUsagePanel title="Provider health" rows={stats.usageByProvider} metric="latency" />
      </div>
    </div>
  );
}
