"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { Activity, Save } from "lucide-react";
import { apiFetch, type ApiEnvelope } from "@/lib/api";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge, Table, Td, Th } from "@/components/ui/table";
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

interface QuotaSetting {
  id: string;
  provider: string;
  modelAlias: string;
  enabled: boolean;
  windowHours: number;
  requestLimit: number | null;
  tokenLimit: number | null;
  concurrencyLimit: number | null;
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
  requestsOverTime: Array<{ time: string; requests: number; errors: number }>;
  requestsByProviderOverTime: Array<{ time: string; key: string; requests: number; errors: number }>;
  requestsByModelOverTime: Array<{ time: string; key: string; requests: number; errors: number }>;
  requestsByApiKeyOverTime: Array<{ time: string; key: string; requests: number; errors: number }>;
  usageByApiKey: UsageAggregate[];
  usageByApiKeyProvider: UsageAggregate[];
  usageByApiKeyModel: UsageAggregate[];
  usageByModel: UsageAggregate[];
  usageByProvider: UsageAggregate[];
  quotaWindows: QuotaWindow[];
  topStats: {
    mostUsedModel: UsageAggregate | null;
    costliestProvider: UsageAggregate | null;
    slowestProvider: UsageAggregate | null;
    highestErrorSource: UsageAggregate | null;
  };
}

const colors = ["#93c5fd", "#34d399", "#fbbf24", "#f87171", "#c084fc", "#22d3ee", "#fb7185", "#a3e635"];
const chartModes = [
  { id: "total", label: "Total" },
  { id: "provider", label: "Provider" },
  { id: "model", label: "Model" },
  { id: "apiKey", label: "API key" }
] as const;

type ChartMode = (typeof chartModes)[number]["id"];

function usd(value: number) {
  return `$${value.toFixed(value >= 1 ? 2 : 4)}`;
}

function percent(value: number | null) {
  if (value === null) return "No limit";
  return `${Math.round(value * 100)}%`;
}

function pivotSeries(rows: Array<{ time: string; key: string; requests: number }>) {
  const keys = Array.from(new Set(rows.map((row) => row.key))).slice(0, 8);
  const byTime = new Map<string, Record<string, string | number>>();
  for (const row of rows) {
    const bucket = byTime.get(row.time) ?? { time: row.time };
    if (keys.includes(row.key)) {
      bucket[row.key] = ((bucket[row.key] as number | undefined) ?? 0) + row.requests;
    }
    byTime.set(row.time, bucket);
  }
  return { data: Array.from(byTime.values()), keys };
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

function QuotaMeter({ label, used, limit, value }: { label: string; used: number; limit: number | null; value: number | null }) {
  const width = value === null ? 0 : Math.min(value * 100, 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className="text-zinc-300">
          {formatNumber(used)} {limit ? `/ ${formatNumber(limit)}` : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full", value !== null && value > 0.85 ? "bg-amber-400" : "bg-blue-400")}
          style={{ width: `${limit ? width : 12}%` }}
        />
      </div>
      <div className="text-xs text-zinc-500">{percent(value)}</div>
    </div>
  );
}

function UsageTable({ title, rows }: { title: string; rows: UsageAggregate[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Requests</Th>
              <Th>Tokens</Th>
              <Th>Cost</Th>
              <Th>Errors</Th>
              <Th>Latency</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 6).map((row) => (
              <tr key={row.id}>
                <Td>{row.label}</Td>
                <Td>{formatNumber(row.requests)}</Td>
                <Td>{formatNumber(row.totalTokens)}</Td>
                <Td>{usd(row.estimatedCost)}</Td>
                <Td>{Math.round(row.errorRate * 100)}%</Td>
                <Td>{row.averageLatencyMs} ms</Td>
              </tr>
            ))}
            {!rows.length ? (
              <tr><Td colSpan={6} className="text-zinc-500">No usage yet</Td></tr>
            ) : null}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [quotaSettings, setQuotaSettings] = useState<QuotaSetting[]>([]);
  const [chartMode, setChartMode] = useState<ChartMode>("total");
  const [usageMode, setUsageMode] = useState<"provider" | "modelAlias">("provider");
  const [error, setError] = useState("");

  function load() {
    Promise.all([
      apiFetch<Stats>("/admin/stats"),
      apiFetch<ApiEnvelope<QuotaSetting[]>>("/admin/quota-settings")
    ])
      .then(([statsResult, quotaResult]) => {
        setStats(statsResult);
        setQuotaSettings(quotaResult.data);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  const timeSeries = useMemo(() => {
    if (!stats) return { data: [], keys: [] as string[] };
    if (chartMode === "total") return { data: stats.requestsOverTime, keys: ["requests", "errors"] };
    if (chartMode === "provider") return pivotSeries(stats.requestsByProviderOverTime);
    if (chartMode === "model") return pivotSeries(stats.requestsByModelOverTime);
    return pivotSeries(stats.requestsByApiKeyOverTime);
  }, [chartMode, stats]);

  const apiKeyChart = useMemo(() => {
    if (!stats) return { data: [], keys: [] as string[] };
    return groupedUsage(usageMode === "provider" ? stats.usageByApiKeyProvider : stats.usageByApiKeyModel, usageMode);
  }, [stats, usageMode]);

  async function patchQuota(body: Partial<QuotaSetting> & { provider: string; modelAlias?: string }) {
    const result = await apiFetch<ApiEnvelope<QuotaSetting[]>>("/admin/quota-settings", {
      method: "PATCH",
      body: JSON.stringify(body)
    });
    setQuotaSettings(result.data);
    apiFetch<Stats>("/admin/stats").then(setStats).catch((err: Error) => setError(err.message));
  }

  if (error) return <div className="text-sm text-red-300">{error}</div>;
  if (!stats) return <div className="text-sm text-zinc-500">Loading gateway status...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Overview</h1>
          <p className="mt-1 text-sm text-zinc-500">Usage, quotas, key activity, latency, cost, and provider health.</p>
        </div>
        <Badge className="border-blue-500/30 text-blue-200">{formatNumber(stats.activeProviders)} providers active</Badge>
      </div>

      <div className="grid grid-cols-6 gap-4">
        <StatCard label="Requests today" value={formatNumber(stats.requestsToday)} detail={`${formatNumber(stats.requestsLast5h)} in 5h`} />
        <StatCard label="Total tokens" value={formatNumber(stats.totalTokens)} detail={`${formatNumber(stats.totalRequests)} requests`} />
        <StatCard label="Average latency" value={`${stats.averageLatencyMs} ms`} detail={stats.topStats.slowestProvider ? `${stats.topStats.slowestProvider.label} slowest` : "No latency yet"} />
        <StatCard label="Error rate" value={`${Math.round(stats.errorRate * 100)}%`} detail={stats.topStats.highestErrorSource ? `${stats.topStats.highestErrorSource.label} has most errors` : "No errors"} />
        <StatCard label="Estimated cost" value={usd(stats.estimatedCost)} detail={stats.topStats.costliestProvider ? `${stats.topStats.costliestProvider.label} leads` : "No cost yet"} />
        <StatCard label="Top model" value={stats.topStats.mostUsedModel?.label ?? "None"} detail={`${formatNumber(stats.topStats.mostUsedModel?.requests ?? 0)} requests`} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>Requests over time</CardTitle>
            <div className="flex rounded-xl border border-zinc-800 p-1">
              {chartModes.map((mode) => (
                <Button
                  key={mode.id}
                  variant="ghost"
                  className={cn("h-7 rounded-lg px-2 text-xs", chartMode === mode.id && "bg-zinc-800 text-zinc-100")}
                  onClick={() => setChartMode(mode.id)}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer>
              <LineChart data={timeSeries.data}>
                <CartesianGrid stroke="#27272a" />
                <XAxis dataKey="time" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }} />
                <Legend />
                {timeSeries.keys.map((key, index) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={colors[index % colors.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>5h quota windows</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {stats.quotaWindows.map((quota) => (
              <div key={`${quota.provider}:${quota.modelAlias}`} className="space-y-3 rounded-lg border border-zinc-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{quota.modelAlias}</div>
                    <div className="text-xs text-zinc-500">{quota.provider} · resets {formatDate(quota.resetsAt)}</div>
                  </div>
                  <Badge>{quota.windowHours}h</Badge>
                </div>
                <QuotaMeter label="Requests" used={quota.requests} limit={quota.requestLimit} value={quota.requestPercent} />
                <QuotaMeter label="Tokens" used={quota.totalTokens} limit={quota.tokenLimit} value={quota.tokenPercent} />
                {quota.concurrencyLimit ? <div className="text-xs text-zinc-500">Concurrency limit: {quota.concurrencyLimit}</div> : null}
              </div>
            ))}
            {!stats.quotaWindows.length ? <div className="text-sm text-zinc-500">No quota windows enabled.</div> : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle>API key usage by {usageMode === "provider" ? "provider" : "model"}</CardTitle>
            <div className="flex rounded-xl border border-zinc-800 p-1">
              <Button variant="ghost" className={cn("h-7 rounded-lg px-2 text-xs", usageMode === "provider" && "bg-zinc-800 text-zinc-100")} onClick={() => setUsageMode("provider")}>
                Provider
              </Button>
              <Button variant="ghost" className={cn("h-7 rounded-lg px-2 text-xs", usageMode === "modelAlias" && "bg-zinc-800 text-zinc-100")} onClick={() => setUsageMode("modelAlias")}>
                Model
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <BarChart data={apiKeyChart.data}>
                <CartesianGrid stroke="#27272a" />
                <XAxis dataKey="label" stroke="#71717a" />
                <YAxis stroke="#71717a" />
                <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }} />
                <Legend />
                {apiKeyChart.keys.map((key, index) => (
                  <Bar key={key} dataKey={key} stackId="usage" fill={colors[index % colors.length]} radius={index === apiKeyChart.keys.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Quota controls</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {quotaSettings.map((setting) => (
              <div key={setting.id} className="space-y-3 rounded-lg border border-zinc-800 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{setting.modelAlias}</div>
                    <div className="text-xs text-zinc-500">{setting.provider}</div>
                  </div>
                  <Button
                    variant={setting.enabled ? "secondary" : "ghost"}
                    className="h-8"
                    onClick={() => patchQuota({ provider: setting.provider, modelAlias: setting.modelAlias, enabled: !setting.enabled })}
                  >
                    <Activity className="h-4 w-4" />
                    {setting.enabled ? "On" : "Off"}
                  </Button>
                </div>
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input
                    placeholder="Request limit"
                    type="number"
                    min={1}
                    defaultValue={setting.requestLimit ?? ""}
                    id={`req-${setting.id}`}
                  />
                  <Input
                    placeholder="Token limit"
                    type="number"
                    min={1}
                    defaultValue={setting.tokenLimit ?? ""}
                    id={`tok-${setting.id}`}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const requestLimit = document.getElementById(`req-${setting.id}`) as HTMLInputElement | null;
                      const tokenLimit = document.getElementById(`tok-${setting.id}`) as HTMLInputElement | null;
                      patchQuota({
                        provider: setting.provider,
                        modelAlias: setting.modelAlias,
                        requestLimit: requestLimit?.value ? Number(requestLimit.value) : null,
                        tokenLimit: tokenLimit?.value ? Number(tokenLimit.value) : null
                      });
                    }}
                  >
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <UsageTable title="Top API keys" rows={stats.usageByApiKey} />
        <UsageTable title="Top models" rows={stats.usageByModel} />
        <UsageTable title="Provider health" rows={stats.usageByProvider} />
      </div>
    </div>
  );
}
