"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { PageShell } from "@/components/page-shell";
import { Ledger } from "@/components/crucible/ledger";
import { apiFetch } from "@/lib/api";

type Range = "24h" | "7d" | "30d" | "alltime";

interface CostBreakdown {
  range: string;
  providers: { name: string; inputTokens: number; outputTokens: number; cost: number; requests: number }[];
  models: { name: string; inputTokens: number; outputTokens: number; cost: number; requests: number; provider: string }[];
}
interface TokenFlow {
  range: string;
  flow: { date: string; provider: string; inputTokens: number; outputTokens: number; cost: number }[];
}
interface HealthStatus {
  overall: string;
  providers: {
    name: string;
    type: string;
    enabled: boolean;
    lastProbe: {
      status: string;
      latencyMs: number | null;
      statusCode: number | null;
      createdAt: string;
      fresh: boolean;
      errorMessage: string | null;
    } | null;
  }[];
  probedAt: string;
}
interface ModelScores {
  throughput: number;
  latency: number;
  cost: number;
  reliability: number;
  volume: number;
  composite: number;
}
interface Stats {
  alltimeSummary: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgDailyCost: number;
    dateRange: { earliest: string | null; latest: string | null };
  };
  dailyBreakdown: {
    date: string;
    requests: number;
    errors: number;
    tokens: number;
    cost: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  modelPerformance: {
    modelAlias: string;
    provider: string;
    requests: number;
    totalTokens: number;
    estimatedCost: number;
    averageLatencyMs: number;
    throughput: number;
    costPer1kTokens: number;
    reliability: number;
    errorRate: number;
    scores?: ModelScores;
  }[];
  usageByApiKey: {
    id: string;
    label: string;
    requests: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
    averageLatencyMs: number;
    errorRate: number;
  }[];
}

const RANGE_LABELS: Record<Range, string> = {
  "24h": "24 Hours",
  "7d": "7 Days",
  "30d": "30 Days",
  alltime: "All Time",
};

const money = (n: number) => `$${n.toFixed(n < 10 ? 3 : 2)}`;
const compact = (n: number) =>
  Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);

const PROVIDER_COLORS: Record<string, string> = {
  "z-ai": "#45b881",
  gemini: "#4dabf7",
  "openai-oauth": "#e5484d",
  openai: "#e5484d",
  openrouter: "#d4a72c",
};

const tooltipStyle = {
  background: "#090b0b",
  border: "1px solid #444",
  borderRadius: 0,
  fontSize: 11,
} as const;

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [costData, setCostData] = useState<CostBreakdown | null>(null);
  const [flowData, setFlowData] = useState<TokenFlow | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, f, h] = await Promise.all([
        apiFetch<Stats>(`/admin/stats?range=${range}`),
        apiFetch<CostBreakdown>(`/admin/stats/cost-breakdown?range=${range}`),
        apiFetch<TokenFlow>(`/admin/stats/token-flow?range=${range}`),
        apiFetch<HealthStatus>("/admin/health"),
      ]);
      setStats(s);
      setCostData(c);
      setFlowData(f);
      setHealth(h);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const probeAll = useCallback(async () => {
    setProbing(true);
    try {
      await apiFetch("/admin/health/probe", { method: "POST" });
      const h = await apiFetch<HealthStatus>("/admin/health");
      setHealth(h);
    } catch {
      /* ignore */
    } finally {
      setProbing(false);
    }
  }, []);

  // C2: cumulative cost trend data
  const cumulativeCostData = useMemo(() => {
    if (!stats?.dailyBreakdown) return [];
    let running = 0;
    return [...stats.dailyBreakdown]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        running += d.cost;
        return {
          date: d.date,
          cumulative: Number(running.toFixed(4)),
          daily: d.cost,
        };
      });
  }, [stats]);

  // C3: token flow stacked by provider
  const tokenFlowStacked = useMemo(() => {
    if (!flowData?.flow) return [];
    const byDate = new Map<string, Record<string, number | string>>();
    for (const f of flowData.flow) {
      const row = byDate.get(f.date) ?? { date: f.date };
      const current = (row[f.provider] as number) ?? 0;
      row[f.provider] = current + f.inputTokens + f.outputTokens;
      byDate.set(f.date, row);
    }
    return Array.from(byDate.values()).sort(
      (a, b) => String(a.date).localeCompare(String(b.date)),
    );
  }, [flowData]);

  return (
    <PageShell flush>
      <main className="ops-room">
        {/* Range selector header */}
        <header className="analytics-header">
          <h1>
            <TrendingUp
              style={{
                width: 13,
                height: 13,
                display: "inline-block",
                verticalAlign: "middle",
                marginRight: 7,
                color: "var(--text-muted)",
              }}
            />
            Analytics
          </h1>
          <div className="range-tabs">
            {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
              <button
                key={r}
                className={r === range ? "active" : ""}
                onClick={() => setRange(r)}
              >
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </header>

        {loading && !stats ? (
          <div className="ops-state">
            <span className="shimmer" />
            LOADING ANALYTICS…
          </div>
        ) : error ? (
          <div className="ops-state ops-error">
            ANALYTICS ERROR // {error}
            <button onClick={load}>RETRY</button>
          </div>
        ) : stats ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* C2: Alltime KPI strip */}
            <section className="kpi-strip">
              <Ledger
                className="ops-ledger"
                size="sm"
                label="ALLTIME REQUESTS"
                value={stats.alltimeSummary.totalRequests}
              />
              <Ledger
                className="ops-ledger"
                size="sm"
                label="ALLTIME TOKENS"
                value={stats.alltimeSummary.totalTokens}
              />
              <Ledger
                className="ops-ledger"
                size="sm"
                label="ALLTIME COST"
                value={stats.alltimeSummary.totalCost}
                format="currency"
                decimals={2}
              />
              <Ledger
                className="ops-ledger"
                size="sm"
                label="AVG DAILY COST"
                value={stats.alltimeSummary.avgDailyCost}
                format="currency"
                decimals={2}
              />
              <Ledger
                className="ops-ledger"
                size="sm"
                label="INPUT TOKENS"
                value={stats.alltimeSummary.totalInputTokens}
              />
              <Ledger
                className="ops-ledger"
                size="sm"
                label="OUTPUT TOKENS"
                value={stats.alltimeSummary.totalOutputTokens}
              />
            </section>

            {/* C2: Cumulative cost trend + Provider cost split */}
            <section className="analytics-grid">
              <div className="analytics-cell span-8">
                <h3>Cumulative Cost Trend / {RANGE_LABELS[range]}</h3>
                {cumulativeCostData.length ? (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cumulativeCostData}>
                        <defs>
                          <linearGradient
                            id="costGrad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0"
                              stopColor="#d4a72c"
                              stopOpacity=".3"
                            />
                            <stop
                              offset="1"
                              stopColor="#d4a72c"
                              stopOpacity="0"
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#252525" vertical={false} />
                        <XAxis dataKey="date" stroke="#555" fontSize={9} />
                        <YAxis
                          stroke="#555"
                          fontSize={9}
                          tickFormatter={compact}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number) => money(v)}
                        />
                        <Area
                          type="monotone"
                          dataKey="cumulative"
                          stroke="#d4a72c"
                          fill="url(#costGrad)"
                          strokeWidth={1.5}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-cell">NO COST DATA</div>
                )}
              </div>
              <div className="analytics-cell span-4">
                <h3>Provider Cost Split</h3>
                {(costData?.providers ?? []).length ? (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={costData!.providers}
                          dataKey="cost"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={90}
                          paddingAngle={2}
                        >
                          {(costData!.providers).map((entry, i) => (
                            <Cell
                              key={i}
                              fill={PROVIDER_COLORS[entry.name] ?? "#666"}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number) => money(v)}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-cell">NO PROVIDER DATA</div>
                )}
              </div>
            </section>

            {/* C3: Daily token flow stacked bar chart */}
            <section className="analytics-grid">
              <div className="analytics-cell span-12">
                <h3>Daily Token Flow by Provider / {RANGE_LABELS[range]}</h3>
                {tokenFlowStacked.length ? (
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tokenFlowStacked}>
                        <CartesianGrid stroke="#252525" vertical={false} />
                        <XAxis dataKey="date" stroke="#555" fontSize={9} />
                        <YAxis
                          stroke="#555"
                          fontSize={9}
                          tickFormatter={compact}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number) => compact(v)}
                        />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        {Object.keys(tokenFlowStacked[0] ?? {})
                          .filter((k) => k !== "date")
                          .map((provider) => (
                            <Bar
                              key={provider}
                              dataKey={provider}
                              stackId="tokens"
                              fill={PROVIDER_COLORS[provider] ?? "#666"}
                            />
                          ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-cell">NO TOKEN FLOW DATA</div>
                )}
              </div>
            </section>

            {/* C4: Model performance leaderboard */}
            <section className="analytics-grid">
              <div className="analytics-cell span-12">
                <h3>Model Performance Leaderboard / {RANGE_LABELS[range]}</h3>
                {(stats.modelPerformance ?? []).length ? (
                  <div className="table-wrap">
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th>MODEL</th>
                          <th>PROVIDER</th>
                          <th>REQ</th>
                          <th>TOKENS</th>
                          <th>THROUGHPUT</th>
                          <th>LATENCY</th>
                          <th>COST EFF</th>
                          <th>RELIABILITY</th>
                          <th>COMPOSITE</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.modelPerformance ?? []).map((m) => (
                          <tr key={m.modelAlias}>
                            <td>
                              <b>{m.modelAlias}</b>
                            </td>
                            <td>{m.provider}</td>
                            <td>{compact(m.requests)}</td>
                            <td>{compact(m.totalTokens)}</td>
                            <td>
                              <span
                                className="score-bar"
                                style={
                                  {
                                    "--score": `${m.scores?.throughput ?? 0}%`,
                                  } as React.CSSProperties
                                }
                              >
                                {m.scores?.throughput ?? 0}
                              </span>
                            </td>
                            <td>
                              <span
                                className="score-bar"
                                style={
                                  {
                                    "--score": `${m.scores?.latency ?? 0}%`,
                                  } as React.CSSProperties
                                }
                              >
                                {m.scores?.latency ?? 0}
                              </span>
                            </td>
                            <td>
                              <span
                                className="score-bar"
                                style={
                                  {
                                    "--score": `${m.scores?.cost ?? 0}%`,
                                  } as React.CSSProperties
                                }
                              >
                                {m.scores?.cost ?? 0}
                              </span>
                            </td>
                            <td>
                              <span
                                className="score-bar"
                                style={
                                  {
                                    "--score": `${m.scores?.reliability ?? 0}%`,
                                  } as React.CSSProperties
                                }
                              >
                                {m.scores?.reliability ?? 0}
                              </span>
                            </td>
                            <td>
                              <b
                                className={
                                  m.scores && m.scores.composite >= 75
                                    ? "text-success"
                                    : ""
                                }
                              >
                                {m.scores?.composite ?? 0}
                              </b>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-cell">NO MODEL PERFORMANCE DATA</div>
                )}
              </div>
            </section>

            {/* C5: Provider health panel with live probes */}
            <section className="analytics-grid">
              <div className="analytics-cell span-12">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <h3 style={{ marginBottom: 0 }}>
                    Provider Health / Active Probes
                  </h3>
                  <button
                    className="control-button"
                    onClick={probeAll}
                    disabled={probing}
                  >
                    {probing ? "PROBING…" : "PROBE NOW"}
                  </button>
                </div>
                {(health?.providers ?? []).filter((p) => p.enabled).length ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill,minmax(280px,1fr))",
                      gap: 1,
                    }}
                  >
                    {(health?.providers ?? [])
                      .filter((p) => p.enabled)
                      .map((p) => {
                        const probe = p.lastProbe;
                        const isUp =
                          probe?.status === "operational" && probe.fresh;
                        const isDegraded = probe?.status === "degraded";
                        const color = isUp
                          ? "var(--success)"
                          : isDegraded
                            ? "var(--warning)"
                            : "var(--danger)";
                        return (
                          <div
                            key={p.name}
                            style={{
                              border: "1px solid var(--border-subtle)",
                              padding: 14,
                              borderRadius: 8,
                              background: "var(--bg-elevated)",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginBottom: 8,
                              }}
                            >
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: color,
                                  boxShadow: `0 0 8px ${color}`,
                                }}
                              />
                              <b
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-primary)",
                                }}
                              >
                                {p.name}
                              </b>
                              <span
                                style={{
                                  fontSize: 9,
                                  color: "var(--text-muted)",
                                  marginLeft: "auto",
                                  textTransform: "uppercase",
                                }}
                              >
                                {isUp
                                  ? "OPERATIONAL"
                                  : isDegraded
                                    ? "DEGRADED"
                                    : "DOWN"}
                              </span>
                            </div>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: 8,
                                fontSize: 10,
                                color: "var(--text-secondary)",
                              }}
                            >
                              <div>
                                <span style={{ color: "var(--text-muted)" }}>
                                  LATENCY
                                </span>
                                <br />
                                <b>
                                  {probe?.latencyMs
                                    ? `${probe.latencyMs}ms`
                                    : "—"}
                                </b>
                              </div>
                              <div>
                                <span style={{ color: "var(--text-muted)" }}>
                                  LAST CHECK
                                </span>
                                <br />
                                <b>
                                  {probe?.createdAt
                                    ? new Date(
                                        probe.createdAt,
                                      ).toLocaleTimeString()
                                    : "—"}
                                </b>
                              </div>
                            </div>
                            {probe?.errorMessage && (
                              <div
                                style={{
                                  fontSize: 9,
                                  color: "var(--danger)",
                                  marginTop: 6,
                                  wordBreak: "break-word",
                                }}
                              >
                                {probe.errorMessage}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <div className="empty-cell">NO ENABLED PROVIDERS</div>
                )}
              </div>
            </section>

            {/* C6: Daily cost bar chart + API key usage */}
            <section className="analytics-grid">
              <div className="analytics-cell span-8">
                <h3>Daily Cost / {RANGE_LABELS[range]}</h3>
                {(stats.dailyBreakdown ?? []).length ? (
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.dailyBreakdown}>
                        <CartesianGrid stroke="#252525" vertical={false} />
                        <XAxis dataKey="date" stroke="#555" fontSize={9} />
                        <YAxis
                          stroke="#555"
                          fontSize={9}
                          tickFormatter={(v: number) => `$${compact(v)}`}
                        />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number) => money(v)}
                        />
                        <Bar
                          dataKey="cost"
                          fill="#d4a72c"
                          radius={[2, 2, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="empty-cell">NO DAILY COST DATA</div>
                )}
              </div>
              <div className="analytics-cell span-4">
                <h3>API Key Usage / Cost</h3>
                {(stats.usageByApiKey ?? []).filter((k) => k.requests > 0)
                  .length ? (
                  <div
                    className="table-wrap"
                    style={{ maxHeight: 220, overflowY: "auto" }}
                  >
                    <table className="ops-table">
                      <thead>
                        <tr>
                          <th>KEY</th>
                          <th>REQ</th>
                          <th>COST</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.usageByApiKey ?? [])
                          .filter((k) => k.requests > 0)
                          .map((k) => (
                            <tr key={k.id}>
                              <td>
                                <b>{k.label}</b>
                              </td>
                              <td>{compact(k.requests)}</td>
                              <td>{money(k.estimatedCost)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-cell">NO API KEY USAGE</div>
                )}
              </div>
            </section>
          </motion.div>
        ) : null}
      </main>
    </PageShell>
  );
}
