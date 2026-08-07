# AiApi-Wrapper Analytics Overhaul Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform the AiApi-Wrapper dashboard from a minimal ops overview into a full analytics platform — active provider health probing, alltime usage/cost analytics, rich multi-dimensional charts, and a dedicated deep-dive analytics page.

**Architecture:** The API (`apps/api`) already computes rich stats (`modelPerformance`, `usageByProvider`, `usageByApiKey`, hourly breakdowns) that the dashboard never uses. We extend the stats endpoint with time-range queries and alltime aggregations, add an active provider health-probe system, and build a new `/analytics` page plus enrich the existing `/dashboard` with more visualizations. All work stays within the existing monorepo (Fastify API + Next.js 15 web).

**Tech Stack:** Fastify 5, SQLite (better-sqlite3 + Drizzle), Next.js 15, React 19, Recharts 2, Tailwind 4, motion (framer-motion), existing Crucible UI components (Ledger, Semaphore, Scriber, Tally).

---

## Current State (from live inspection)

- **DB:** 41,608 requests since 2026-07-04. 2.06B total tokens. $2,006 retail-value cost. 24 model routes across 3 providers (z-ai, gemini, openai-oauth).
- **Running:** API as bare `node dist/server.js` (PID 131398, :18789), web as `next-server v16.2.12` (:3100, redirect domain samuelm.de). No Docker, no systemd unit.
- **Dashboard:** Single `/dashboard` page — incident rail, 6 KPI Ledgers, 48h area chart, quota clock, provider Semaphore bars, model cost table, API key rank bars, execution tape. Good "ops room" but no analytics depth.
- **Stats API:** Already returns `modelPerformance` with composite 0-100 scores, `usageByApiKeyProvider`, `usageByApiKeyModel`, `requestsByProviderOverTime`, `requestsByModelOverTime` — ALL UNUSED by frontend.
- **Pricing:** `MODEL_PRICING` table + `estimateCostUsd()` in packages/core. Accurate per-token retail pricing.
- **Provider health:** Inferred from recent request logs only. If no recent requests → "idle" (looks like "down"). No active probing.

---

## Part A: Active Provider Health Probes (Backend)

### Task A1: Create health probe DB table and schema

**Objective:** Store periodic provider health-check results so the dashboard can show real "is this provider actually up" status.

**Files:**
- Modify: `apps/api/src/db/schema.ts` (add table at end)
- Create: `apps/api/src/routes/health-probes.ts`

**Step 1: Add schema table**

Add to `apps/api/src/db/schema.ts`:

```typescript
export const healthProbes = sqliteTable("health_probes", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  status: text("status").notNull(), // "operational" | "degraded" | "incident"
  latencyMs: integer("latency_ms"),
  statusCode: integer("status_code"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull()
});
```

**Step 2: Create migration**

Run via Python + sqlite3:

```python
import sqlite3
db = sqlite3.connect('data/gateway.db')
db.execute("""CREATE TABLE IF NOT EXISTS health_probes (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  status_code INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL
)""")
db.execute("CREATE INDEX IF NOT EXISTS idx_health_probes_provider ON health_probes(provider, created_at DESC)")
db.commit()
```

**Step 3: Commit**

```bash
git add apps/api/src/db/schema.ts
git commit -m "feat: add health_probes table for active provider probing"
```

---

### Task A2: Implement health probe endpoint

**Objective:** API endpoint that actively tests each provider by sending a minimal request, stores the result, and returns current health.

**Files:**
- Create: `apps/api/src/routes/health-probes.ts`
- Modify: `apps/api/src/server.ts` (register route)

**Step 1: Write health probe route**

Create `apps/api/src/routes/health-probes.ts`:

```typescript
import { lt, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { db } from "../db/client.js";
import { healthProbes, providers, modelRoutes } from "../db/schema.js";
import { requireAdminAuth } from "../middleware/auth.js";
import { anthropicAdapter } from "../providers/anthropic.js";
import { geminiAdapter } from "../providers/gemini.js";
import { createOpenAiCompatibleAdapter } from "../providers/openai-compatible.js";
import { openAiAdapter } from "../providers/openai.js";
import { openRouterAdapter } from "../providers/openrouter.js";
import type { ProviderAdapter } from "../providers/types.js";

const adapters: Record<string, ProviderAdapter> = {
  openai: openAiAdapter,
  openrouter: openRouterAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
  custom: createOpenAiCompatibleAdapter("custom")
};

const PROBE_MESSAGE = "Say 'ok' in exactly those two characters.";
const MAX_PROBE_TOKENS = 5;
const PROBE_TIMEOUT_MS = 15_000;

interface ProbeResult {
  provider: string;
  status: "operational" | "degraded" | "incident";
  latencyMs: number | null;
  statusCode: number | null;
  errorMessage: string | null;
}

async function probeProvider(
  providerName: string,
  providerType: string,
  providerBaseUrl: string | null
): Promise<ProbeResult> {
  const route = db.select().from(modelRoutes).all().find((r) => r.provider === providerName && r.enabled);
  if (!route) {
    return { provider: providerName, status: "incident", latencyMs: null, statusCode: null, errorMessage: "No enabled model route" };
  }
  const adapter = adapters[providerType] ?? adapters[providerName];
  if (!adapter) {
    return { provider: providerName, status: "incident", latencyMs: null, statusCode: null, errorMessage: "No adapter registered" };
  }
  const start = Date.now();
  try {
    await Promise.race([
      adapter.complete(
        {
          modelAlias: route.alias,
          messages: [{ role: "user", content: PROBE_MESSAGE }],
          maxTokens: MAX_PROBE_TOKENS,
          stream: false
        },
        { provider: providerName, model: route.realModel },
        {
          name: providerName,
          type: providerType as "openai" | "openrouter" | "gemini" | "anthropic" | "custom",
          baseUrl: providerBaseUrl ?? undefined,
          enabled: true
        }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Probe timeout")), PROBE_TIMEOUT_MS)
      )
    ]);
    return {
      provider: providerName,
      status: "operational",
      latencyMs: Date.now() - start,
      statusCode: 200,
      errorMessage: null
    };
  } catch (error) {
    return {
      provider: providerName,
      status: "incident",
      latencyMs: Date.now() - start,
      statusCode: null,
      errorMessage: error instanceof Error ? error.message : "Probe failed"
    };
  }
}

function statusFromProbes(probes: ProbeResult[]): "operational" | "degraded" | "incident" {
  if (!probes.length) return "incident";
  const incidents = probes.filter((p) => p.status === "incident").length;
  if (incidents === probes.length) return "incident";
  if (incidents > 0) return "degraded";
  return "operational";
}

export async function healthProbeRoutes(app: FastifyInstance): Promise<void> {
  // Get current health (latest probe per provider + recent log-inferred status)
  app.get("/admin/health", { preHandler: requireAdminAuth }, async () => {
    const allProviders = db.select().from(providers).all();
    const now = new Date();
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    const recentProbes = allProviders.map((p) => {
      const latest = db.select().from(healthProbes)
        .where(eq(healthProbes.provider, p.name))
        .orderBy(desc(healthProbes.createdAt))
        .limit(1)
        .all();
      return { provider: p, latest: latest[0] ?? null };
    });

    return {
      overall: statusFromProbes(
        recentProbes
          .filter((rp) => rp.latest && new Date(rp.latest.createdAt) > new Date(tenMinAgo))
          .map((rp) => ({
            provider: rp.provider.name,
            status: rp.latest!.status as "operational" | "degraded" | "incident",
            latencyMs: rp.latest!.latencyMs,
            statusCode: rp.latest!.statusCode,
            errorMessage: rp.latest!.errorMessage
          }))
      ),
      providers: recentProbes.map((rp) => ({
        name: rp.provider.name,
        type: rp.provider.type,
        enabled: rp.provider.enabled,
        lastProbe: rp.latest
          ? {
              status: rp.latest.status,
              latencyMs: rp.latest.latencyMs,
              statusCode: rp.latest.statusCode,
              errorMessage: rp.latest.errorMessage,
              createdAt: rp.latest.createdAt,
              fresh: new Date(rp.latest.createdAt) > new Date(tenMinAgo)
            }
          : null
      })),
      probedAt: now.toISOString()
    };
  });

  // Trigger active probe of all enabled providers
  app.post("/admin/health/probe", { preHandler: requireAdminAuth }, async () => {
    const allProviders = db.select().from(providers).all().filter((p) => p.enabled);
    const results: ProbeResult[] = [];

    // Probe sequentially to avoid hammering all providers simultaneously
    for (const provider of allProviders) {
      const result = await probeProvider(provider.name, provider.type, provider.baseUrl);
      results.push(result);

      const now = new Date().toISOString();
      db.insert(healthProbes).values({
        id: nanoid(),
        provider: result.provider,
        status: result.status,
        latencyMs: result.latencyMs,
        statusCode: result.statusCode,
        errorMessage: result.errorMessage,
        createdAt: now
      }).run();
    }

    // Clean up probes older than 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.delete(healthProbes).where(lt(healthProbes.createdAt, sevenDaysAgo)).run();

    return {
      overall: statusFromProbes(results),
      results,
      probedAt: new Date().toISOString()
    };
  });

  // Get probe history for charts
  app.get("/admin/health/history", { preHandler: requireAdminAuth }, async () => {
    const hours = 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const allProbes = db.select().from(healthProbes).all().filter((p) => p.createdAt >= since);

    const byProvider = new Map<string, typeof allProbes>();
    for (const probe of allProbes) {
      const arr = byProvider.get(probe.provider) ?? [];
      arr.push(probe);
      byProvider.set(probe.provider, arr);
    }

    return {
      hours,
      history: Array.from(byProvider.entries()).map(([provider, probes]) => ({
        provider,
        probes: probes
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((p) => ({
            time: p.createdAt,
            status: p.status,
            latencyMs: p.latencyMs,
            errorMessage: p.errorMessage
          }))
      }))
    };
  });
}
```

**Step 2: Register in server.ts**

Find the route registration block in `apps/api/src/server.ts` and add:

```typescript
import { healthProbeRoutes } from "./routes/health-probes.js";
// ... in the route registration section:
await app.register(healthProbeRoutes);
```

**Step 3: Build and verify**

```bash
cd /home/samuel/AiApi-Wrapper
pnpm --filter @model-console/api typecheck
```
Expected: no errors

**Step 4: Commit**

```bash
git add apps/api/src/routes/health-probes.ts apps/api/src/server.ts
git commit -m "feat: active provider health probing with history"
```

---

### Task A3: Auto-probe on interval (background timer)

**Objective:** Automatically probe providers every 5 minutes so health is always fresh without manual triggers.

**Files:**
- Modify: `apps/api/src/routes/health-probes.ts` (add `startAutoProbe` function)
- Modify: `apps/api/src/server.ts` (call after routes registered)

**Step 1: Add auto-probe function**

Add to `health-probes.ts`:

```typescript
const AUTO_PROBE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let autoProbeTimer: NodeJS.Timeout | null = null;

export function startAutoProbe(): void {
  if (autoProbeTimer) return;

  // Initial probe after 10s startup grace
  setTimeout(async () => {
    try {
      const allProviders = db.select().from(providers).all().filter((p) => p.enabled);
      for (const provider of allProviders) {
        const result = await probeProvider(provider.name, provider.type, provider.baseUrl);
        const now = new Date().toISOString();
        db.insert(healthProbes).values({
          id: nanoid(),
          provider: result.provider,
          status: result.status,
          latencyMs: result.latencyMs,
          statusCode: result.statusCode,
          errorMessage: result.errorMessage,
          createdAt: now
        }).run();
      }
    } catch { /* silent — probe failures are non-fatal */ }
  }, 10_000);

  // Recurring interval
  autoProbeTimer = setInterval(async () => {
    try {
      const allProviders = db.select().from(providers).all().filter((p) => p.enabled);
      for (const provider of allProviders) {
        const result = await probeProvider(provider.name, provider.type, provider.baseUrl);
        const now = new Date().toISOString();
        db.insert(healthProbes).values({
          id: nanoid(),
          provider: result.provider,
          status: result.status,
          latencyMs: result.latencyMs,
          statusCode: result.statusCode,
          errorMessage: result.errorMessage,
          createdAt: now
        }).run();
      }
      // Cleanup old probes
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      db.delete(healthProbes).where(lt(healthProbes.createdAt, sevenDaysAgo)).run();
    } catch { /* silent */ }
  }, AUTO_PROBE_INTERVAL_MS);
}
```

**Step 2: Call in server.ts**

After route registration, before `app.listen()`:

```typescript
import { startAutoProbe } from "./routes/health-probes.js";
// after routes registered:
startAutoProbe();
```

**Step 3: Build, verify, commit**

```bash
pnpm --filter @model-console/api typecheck
git add apps/api/src/routes/health-probes.ts apps/api/src/server.ts
git commit -m "feat: auto-probe providers every 5 minutes"
```

---

## Part B: Enhanced Stats API (Backend)

### Task B1: Add time-range parameter to stats endpoint

**Objective:** Allow the frontend to query stats for specific time ranges (24h, 7d, 30d, alltime) instead of always computing alltime + today.

**Files:**
- Modify: `apps/api/src/routes/admin-stats.ts`

**Step 1: Add range parameter**

Add query param parsing at the top of the `/admin/stats` handler:

```typescript
// After: app.get("/admin/stats", { preHandler: requireAdminAuth }, async (request) => {
const rangeParam = (request.query as { range?: string }).range ?? "alltime";
const rangeMs: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "alltime": Number.MAX_SAFE_INTEGER
};
const rangeDuration = rangeMs[rangeParam] ?? rangeMs.alltime;
const rangeStart = new Date(Date.now() - rangeDuration).toISOString();

// Filter requests by range (instead of allRequests for range-scoped metrics)
const rangedRequests = allRequests.filter((r) => r.createdAt >= rangeStart);
```

Then compute all the existing aggregations using `rangedRequests` instead of `allRequests` for the range-scoped metrics (hourly breakdown, usage by provider/model/key, etc.). Keep `allRequests` for the alltime totals and `totalRequests` field.

Add `range` and `rangeStart` to the returned object.

**Step 2: Add alltime summary to the return**

Add a new field to the response:

```typescript
alltimeSummary: {
  totalRequests: allRequests.length,
  totalTokens,
  totalCost: Number(allRequests.reduce((t, r) => t + (r.estimatedCost ?? 0), 0).toFixed(4)),
  totalInputTokens: allRequests.reduce((t, r) => t + (r.inputTokens ?? 0), 0),
  totalOutputTokens: allRequests.reduce((t, r) => t + (r.outputTokens ?? 0), 0),
  avgDailyCost: allRequests.length > 0
    ? Number((allRequests.reduce((t, r) => t + (r.estimatedCost ?? 0), 0) / Math.max(1, Math.ceil((Date.now() - new Date(allRequests[0]?.createdAt ?? Date.now()).getTime()) / 86400000))).toFixed(4))
    : 0,
  dateRange: {
    earliest: allRequests[0]?.createdAt ?? null,
    latest: allRequests[allRequests.length - 1]?.createdAt ?? null
  }
},
```

**Step 3: Add daily breakdown**

After the hourly computation, add a daily aggregation:

```typescript
const daily = new Map<string, { date: string; requests: number; errors: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }>();
for (const request of rangedRequests) {
  const date = request.createdAt.slice(0, 10);
  const bucket = daily.get(date) ?? { date, requests: 0, errors: 0, tokens: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
  bucket.requests += 1;
  if (request.status === "error") bucket.errors += 1;
  bucket.tokens += (request.inputTokens ?? 0) + (request.outputTokens ?? 0);
  bucket.inputTokens += request.inputTokens ?? 0;
  bucket.cost += request.estimatedCost ?? 0;
  daily.set(date, bucket);
}
```

Add `dailyBreakdown` to the return:

```typescript
dailyBreakdown: Array.from(daily.values()).map((d) => ({
  ...d,
  cost: Number(d.cost.toFixed(6))
})),
```

**Step 4: Typecheck, commit**

```bash
pnpm --filter @model-console/api typecheck
git add apps/api/src/routes/admin-stats.ts
git commit -m "feat: add time-range query and daily breakdown to stats"
```

---

### Task B2: Add provider cost comparison and token flow endpoints

**Objective:** Dedicated endpoints for the analytics page to draw richer charts.

**Files:**
- Modify: `apps/api/src/routes/admin-stats.ts`

**Step 1: Add `/admin/stats/cost-breakdown` endpoint**

```typescript
app.get("/admin/stats/cost-breakdown", { preHandler: requireAdminAuth }, async (request) => {
  const rangeParam = (request.query as { range?: string }).range ?? "alltime";
  const rangeMs: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000, "alltime": Number.MAX_SAFE_INTEGER
  };
  const since = new Date(Date.now() - (rangeMs[rangeParam] ?? rangeMs.alltime)).toISOString();
  const allRequests = db.select().from(requests).all().filter((r) => r.createdAt >= since);

  const byProvider = new Map<string, { inputTokens: number; outputTokens: number; cost: number; requests: number }>();
  const byModel = new Map<string, { inputTokens: number; outputTokens: number; cost: number; requests: number; provider: string }>();

  for (const r of allRequests) {
    const p = byProvider.get(r.provider) ?? { inputTokens: 0, outputTokens: 0, cost: 0, requests: 0 };
    p.inputTokens += r.inputTokens ?? 0;
    p.outputTokens += r.outputTokens ?? 0;
    p.cost += r.estimatedCost ?? 0;
    p.requests += 1;
    byProvider.set(r.provider, p);

    const m = byModel.get(r.modelAlias) ?? { inputTokens: 0, outputTokens: 0, cost: 0, requests: 0, provider: r.provider };
    m.inputTokens += r.inputTokens ?? 0;
    m.outputTokens += r.outputTokens ?? 0;
    m.cost += r.estimatedCost ?? 0;
    m.requests += 1;
    byModel.set(r.modelAlias, m);
  }

  return {
    range: rangeParam,
    providers: Array.from(byProvider.entries()).map(([name, v]) => ({
      name, ...v, cost: Number(v.cost.toFixed(6))
    })).sort((a, b) => b.cost - a.cost),
    models: Array.from(byModel.entries()).map(([name, v]) => ({
      name, ...v, cost: Number(v.cost.toFixed(6))
    })).sort((a, b) => b.cost - a.cost)
  };
});
```

**Step 2: Add `/admin/stats/token-flow` endpoint**

```typescript
app.get("/admin/stats/token-flow", { preHandler: requireAdminAuth }, async (request) => {
  const rangeParam = (request.query as { range?: string }).range ?? "7d";
  const rangeMs: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000, "alltime": Number.MAX_SAFE_INTEGER
  };
  const since = new Date(Date.now() - (rangeMs[rangeParam] ?? rangeMs["7d"])).toISOString();
  const allRequests = db.select().from(requests).all().filter((r) => r.createdAt >= since);

  // Daily stacked by provider
  const dailyByProvider = new Map<string, { date: string; provider: string; inputTokens: number; outputTokens: number; cost: number }>();
  for (const r of allRequests) {
    const date = r.createdAt.slice(0, 10);
    const key = `${date}:${r.provider}`;
    const bucket = dailyByProvider.get(key) ?? { date, provider: r.provider, inputTokens: 0, outputTokens: 0, cost: 0 };
    bucket.inputTokens += r.inputTokens ?? 0;
    bucket.outputTokens += r.outputTokens ?? 0;
    bucket.cost += r.estimatedCost ?? 0;
    dailyByProvider.set(key, bucket);
  }

  return {
    range: rangeParam,
    flow: Array.from(dailyByProvider.values())
      .map((v) => ({ ...v, cost: Number(v.cost.toFixed(6)) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  };
});
```

**Step 3: Typecheck, commit**

```bash
pnpm --filter @model-console/api typecheck
git add apps/api/src/routes/admin-stats.ts
git commit -m "feat: add cost-breakdown and token-flow stats endpoints"
```

---

## Part C: New Analytics Page (Frontend)

### Task C1: Create analytics page skeleton with time-range selector

**Objective:** New `/analytics` route with a range selector (24h/7d/30d/alltime) that drives all charts.

**Files:**
- Create: `apps/web/app/analytics/page.tsx`

**Step 1: Write page skeleton**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { BarChart3, DollarSign, Cpu, Clock, Activity, Zap, TrendingUp, Layers } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, StackedBar } from "recharts";
import { PageShell } from "@/components/page-shell";
import { Ledger } from "@/components/crucible/ledger";
import { apiFetch } from "@/lib/api";
import { MODEL_PRICING } from "@model-console/core/pricing";

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
  providers: { name: string; type: string; enabled: boolean; lastProbe: { status: string; latencyMs: number | null; createdAt: string; fresh: boolean; errorMessage: string | null } | null }[];
  probedAt: string;
}
interface Stats {
  alltimeSummary: { totalRequests: number; totalTokens: number; totalCost: number; totalInputTokens: number; totalOutputTokens: number; avgDailyCost: number; dateRange: { earliest: string | null; latest: string | null } };
  dailyBreakdown: { date: string; requests: number; errors: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }[];
  modelPerformance: { modelAlias: string; provider: string; requests: number; totalTokens: number; estimatedCost: number; averageLatencyMs: number; throughput: number; costPer1kTokens: number; reliability: number; errorRate: number; scores?: { throughput: number; latency: number; cost: number; reliability: number; volume: number; composite: number } }[];
  usageByModel: { id: string; label: string; provider?: string; modelAlias?: string; requests: number; errors: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number; averageLatencyMs: number; errorRate: number }[];
  usageByProvider: { id: string; label: string; requests: number; errors: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number; averageLatencyMs: number; errorRate: number }[];
  usageByApiKey: { id: string; label: string; requests: number; errors: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number; averageLatencyMs: number; errorRate: number }[];
  requestsOverTime: { time: string; requests: number; errors: number; totalTokens: number; estimatedCost: number; averageLatencyMs: number }[];
}

const RANGE_LABELS: Record<Range, string> = { "24h": "24 Hours", "7d": "7 Days", "30d": "30 Days", alltime: "All Time" };
const money = (n: number) => `$${n.toFixed(n < 10 ? 3 : 2)}`;
const compact = (n: number) => Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const PROVIDER_COLORS: Record<string, string> = { "z-ai": "#45b881", gemini: "#4dabf7", "openai-oauth": "#e5484d", openai: "#e5484d", openrouter: "#d4a72c" };

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const [costData, setCostData] = useState<CostBreakdown | null>(null);
  const [flowData, setFlowData] = useState<TokenFlow | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, f, h] = await Promise.all([
        apiFetch<Stats>(`/admin/stats?range=${range}`),
        apiFetch<CostBreakdown>(`/admin/stats/cost-breakdown?range=${range}`),
        apiFetch<TokenFlow>(`/admin/stats/token-flow?range=${range}`),
        apiFetch<HealthStatus>("/admin/health")
      ]);
      setStats(s); setCostData(c); setFlowData(f); setHealth(h); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally { setLoading(false); }
  }, [range]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  // ... charts rendered in subsequent tasks
  return (
    <PageShell flush>
      <main className="ops-room">
        {/* Range selector */}
        <header className="analytics-header">
          <h1>Analytics</h1>
          <div className="range-tabs">
            {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
              <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        </header>

        {/* Charts rendered in tasks C2-C6 */}
        {loading && !stats ? (
          <div className="ops-state"><span className="shimmer" />LOADING ANALYTICS…</div>
        ) : error ? (
          <div className="ops-state ops-error">ANALYTICS ERROR // {error}</div>
        ) : (
          <>{/* content from C2-C6 */}</>
        )}
      </main>
    </PageShell>
  );
}
```

**Step 2: Add CSS for analytics page**

Add to `apps/web/app/globals.css`:

```css
.analytics-header{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--border-default);background:var(--bg-elevated)}
.analytics-header h1{font-size:13px;font-weight:700;letter-spacing:-.01em;color:var(--text-primary)}
.range-tabs{display:flex;gap:0;border:1px solid var(--border-default);border-radius:7px;overflow:hidden}
.range-tabs button{padding:5px 14px;font-size:11px;font-weight:510;color:var(--text-muted);background:transparent;border:0;border-right:1px solid var(--border-default);transition:.15s;cursor:pointer}
.range-tabs button:last-child{border-right:0}
.range-tabs button:hover{color:var(--text-primary);background:var(--bg-hover)}
.range-tabs button.active{color:var(--text-primary);background:var(--bg-hover)}
.analytics-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:1px;background:var(--border-default);border-bottom:1px solid var(--border-default)}
.analytics-cell{background:var(--bg-surface);padding:16px;min-height:0}
.analytics-cell h3{font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--text-secondary);margin-bottom:12px;text-transform:uppercase}
.span-3{grid-column:span 3} .span-4{grid-column:span 4} .span-6{grid-column:span 6} .span-8{grid-column:span 8} .span-12{grid-column:span 12}
@media(max-width:1100px){.span-3,.span-4{grid-column:span 6}.span-8{grid-column:span 12}}
@media(max-width:640px){.span-3,.span-4,.span-6,.span-8{grid-column:span 12}}
```

**Step 3: Add to sidebar navigation**

Modify `apps/web/components/app-sidebar.tsx`, add after the "Overview" entry:

```typescript
{ href: "/analytics", label: "Analytics", icon: TrendingUp },
```

Import `TrendingUp` from lucide-react.

**Step 4: Verify build**

```bash
pnpm --filter @model-console/web typecheck
```

**Step 5: Commit**

```bash
git add apps/web/app/analytics/page.tsx apps/web/app/globals.css apps/web/components/app-sidebar.tsx
git commit -m "feat: analytics page skeleton with time-range selector"
```

---

### Task C2: Alltime KPI strip + cumulative cost chart

**Objective:** Top row showing alltime totals (requests, tokens, cost, avg daily cost) with a cumulative cost trend line.

**Files:**
- Modify: `apps/web/app/analytics/page.tsx`

**Step 1: Add KPI + cumulative chart**

Add inside the content section:

```tsx
{/* Alltime KPIs */}
<section className="kpi-strip">
  <Ledger className="ops-ledger" size="sm" label="ALLTIME REQUESTS" value={stats!.alltimeSummary.totalRequests} />
  <Ledger className="ops-ledger" size="sm" label="ALLTIME TOKENS" value={stats!.alltimeSummary.totalTokens} />
  <Ledger className="ops-ledger" size="sm" label="ALLTIME COST" value={stats!.alltimeSummary.totalCost} format="currency" decimals={2} />
  <Ledger className="ops-ledger" size="sm" label="AVG DAILY COST" value={stats!.alltimeSummary.avgDailyCost} format="currency" decimals={2} />
  <Ledger className="ops-ledger" size="sm" label="INPUT TOKENS" value={stats!.alltimeSummary.totalInputTokens} />
  <Ledger className="ops-ledger" size="sm" label="OUTPUT TOKENS" value={stats!.alltimeSummary.totalOutputTokens} />
</section>

{/* Cumulative cost chart */}
<section className="analytics-grid">
  <div className="analytics-cell span-8">
    <h3>Cumulative Cost Trend / {RANGE_LABELS[range]}</h3>
    <div style={{height:240}}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={cumulativeCostData}>
          <defs>
            <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#d4a72c" stopOpacity=".3" />
              <stop offset="1" stopColor="#d4a72c" stopOpacity="0" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#252525" vertical={false} />
          <XAxis dataKey="date" stroke="#555" fontSize={9} />
          <YAxis stroke="#555" fontSize={9} tickFormatter={compact} />
          <Tooltip contentStyle={{background:"#090b0b",border:"1px solid #444",borderRadius:0,fontSize:11}} formatter={(v:number)=>money(v)} />
          <Area type="monotone" dataKey="cumulative" stroke="#d4a72c" fill="url(#costGrad)" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </div>
  <div className="analytics-cell span-4">
    <h3>Provider Cost Split</h3>
    <div style={{height:240}}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={costData?.providers ?? []} dataKey="cost" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
            {(costData?.providers ?? []).map((entry, i) => (
              <Cell key={i} fill={PROVIDER_COLORS[entry.name] ?? "#666"} />
            ))}
          </Pie>
          <Tooltip contentStyle={{background:"#090b0b",border:"1px solid #444",borderRadius:0,fontSize:11}} formatter={(v:number)=>money(v)} />
          <Legend wrapperStyle={{fontSize:10}} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  </div>
</section>
```

**Step 2: Add cumulative cost computation**

Add to the component body, after stats are loaded:

```tsx
const cumulativeCostData = useMemo(() => {
  if (!stats?.dailyBreakdown) return [];
  let running = 0;
  return [...stats.dailyBreakdown]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => { running += d.cost; return { date: d.date, cumulative: Number(running.toFixed(4)), daily: d.cost }; });
}, [stats]);
```

**Step 3: Commit**

```bash
git add apps/web/app/analytics/page.tsx
git commit -m "feat: alltime KPIs + cumulative cost chart + provider pie"
```

---

### Task C3: Daily token flow stacked bar chart

**Objective:** Stacked bar chart showing daily token usage broken down by provider.

**Files:**
- Modify: `apps/web/app/analytics/page.tsx`

**Step 1: Add stacked bar chart**

```tsx
{/* Daily token flow by provider */}
<section className="analytics-grid">
  <div className="analytics-cell span-12">
    <h3>Daily Token Flow by Provider / {RANGE_LABELS[range]}</h3>
    <div style={{height:260}}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={tokenFlowStacked}>
          <CartesianGrid stroke="#252525" vertical={false} />
          <XAxis dataKey="date" stroke="#555" fontSize={9} />
          <YAxis stroke="#555" fontSize={9} tickFormatter={compact} />
          <Tooltip contentStyle={{background:"#090b0b",border:"1px solid #444",borderRadius:0,fontSize:11}} formatter={(v:number)=>compact(v)} />
          <Legend wrapperStyle={{fontSize:10}} />
          {Object.keys(tokenFlowStacked[0] ?? {}).filter((k) => k !== "date").map((provider) => (
            <Bar key={provider} dataKey={provider} stackId="tokens" fill={PROVIDER_COLORS[provider] ?? "#666"} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
</section>
```

**Step 2: Add stacked data transform**

```tsx
const tokenFlowStacked = useMemo(() => {
  if (!flowData?.flow) return [];
  const byDate = new Map<string, Record<string, number>>();
  for (const f of flowData.flow) {
    const row = byDate.get(f.date) ?? { date: f.date };
    row[f.provider] = (row[f.provider] ?? 0) + f.inputTokens + f.outputTokens;
    byDate.set(f.date, row);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}, [flowData]);
```

**Step 3: Commit**

```bash
git add apps/web/app/analytics/page.tsx
git commit -m "feat: daily token flow stacked bar chart by provider"
```

---

### Task C4: Model performance comparison table with scores

**Objective:** Full sortable table showing all models with performance scores (throughput, latency, cost, reliability, composite).

**Files:**
- Modify: `apps/web/app/analytics/page.tsx`

**Step 1: Add model performance table**

```tsx
{/* Model performance leaderboard */}
<section className="analytics-grid">
  <div className="analytics-cell span-12">
    <h3>Model Performance Leaderboard / {RANGE_LABELS[range]}</h3>
    <div className="table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>MODEL</th><th>PROVIDER</th><th>REQ</th><th>TOKENS</th>
            <th>THROUGHPUT</th><th>LATENCY</th><th>COST EFF</th>
            <th>RELIABILITY</th><th>COMPOSITE</th>
          </tr>
        </thead>
        <tbody>
          {(stats?.modelPerformance ?? []).map((m) => (
            <tr key={m.modelAlias}>
              <td><b>{m.modelAlias}</b></td>
              <td>{m.provider}</td>
              <td>{compact(m.requests)}</td>
              <td>{compact(m.totalTokens)}</td>
              <td>
                <span className="score-bar" style={{"--score":`${m.scores?.throughput ?? 0}%`} as React.CSSProperties}>
                  {m.scores?.throughput ?? 0}
                </span>
              </td>
              <td>
                <span className="score-bar" style={{"--score":`${m.scores?.latency ?? 0}%`} as React.CSSProperties}>
                  {m.scores?.latency ?? 0}
                </span>
              </td>
              <td>
                <span className="score-bar" style={{"--score":`${m.scores?.cost ?? 0}%`} as React.CSSProperties}>
                  {m.scores?.cost ?? 0}
                </span>
              </td>
              <td>
                <span className="score-bar" style={{"--score":`${m.scores?.reliability ?? 0}%`} as React.CSSProperties}>
                  {m.scores?.reliability ?? 0}
                </span>
              </td>
              <td><b className={m.scores && m.scores.composite >= 75 ? "text-success" : ""}>{m.scores?.composite ?? 0}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
</section>
```

**Step 2: Add score-bar CSS**

Add to `globals.css`:

```css
.score-bar{display:inline-flex;align-items:center;gap:6px;font-size:10px;color:var(--text-secondary);font-variant-numeric:tabular-nums}
.score-bar::before{content:"";display:inline-block;width:36px;height:3px;border-radius:0;background:var(--border-subtle);position:relative;overflow:hidden;
  background:linear-gradient(to right,var(--success) var(--score),var(--border-subtle) var(--score))}
.text-success{color:var(--success)}
```

**Step 3: Commit**

```bash
git add apps/web/app/analytics/page.tsx apps/web/app/globals.css
git commit -m "feat: model performance leaderboard with visual scores"
```

---

### Task C5: Provider health panel with live probes

**Objective:** Visual provider health cards showing active probe results with latency, last-checked time, and a manual probe button.

**Files:**
- Modify: `apps/web/app/analytics/page.tsx`

**Step 1: Add health panel**

```tsx
{/* Provider health with live probes */}
<section className="analytics-grid">
  <div className="analytics-cell span-12">
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
      <h3 style={{marginBottom:0}}>Provider Health / Active Probes</h3>
      <button className="control-button" onClick={probeAll} disabled={probing}>
        {probing ? "PROBING…" : "PROBE NOW"}
      </button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:1}}>
      {(health?.providers ?? []).filter((p) => p.enabled).map((p) => {
        const probe = p.lastProbe;
        const isUp = probe?.status === "operational" && probe.fresh;
        const isDegraded = probe?.status === "degraded";
        const isDown = !probe || (!probe.fresh && probe.status !== "operational") || probe.status === "incident";
        const color = isUp ? "var(--success)" : isDegraded ? "var(--warning)" : "var(--danger)";
        return (
          <div key={p.name} style={{border:"1px solid var(--border-subtle)",padding:14,borderRadius:8,background:"var(--bg-elevated)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}`}} />
              <b style={{fontSize:12,color:"var(--text-primary)"}}>{p.name}</b>
              <span style={{fontSize:9,color:"var(--text-muted)",marginLeft:"auto",textTransform:"uppercase"}}>
                {isUp ? "OPERATIONAL" : isDegraded ? "DEGRADED" : "DOWN"}
              </span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:10,color:"var(--text-secondary)"}}>
              <div><span style={{color:"var(--text-muted)"}}>LATENCY</span><br/><b>{probe?.latencyMs ? `${probe.latencyMs}ms` : "—"}</b></div>
              <div><span style={{color:"var(--text-muted)"}}>LAST CHECK</span><br/><b>{probe?.createdAt ? new Date(probe.createdAt).toLocaleTimeString() : "—"}</b></div>
            </div>
            {probe?.errorMessage && (
              <div style={{fontSize:9,color:"var(--danger)",marginTop:6,wordBreak:"break-word"}}>{probe.errorMessage}</div>
            )}
          </div>
        );
      })}
    </div>
  </div>
</section>
```

**Step 2: Add probe handler**

```tsx
const [probing, setProbing] = useState(false);
const probeAll = useCallback(async () => {
  setProbing(true);
  try {
    await apiFetch("/admin/health/probe", { method: "POST" });
    const h = await apiFetch<HealthStatus>("/admin/health");
    setHealth(h);
  } catch { /* ignore */ } finally { setProbing(false); }
}, []);
```

**Step 3: Commit**

```bash
git add apps/web/app/analytics/page.tsx
git commit -m "feat: provider health panel with live active probes"
```

---

### Task C6: Daily cost bar chart + API key usage breakdown

**Objective:** Daily cost bar chart and API key usage comparison.

**Files:**
- Modify: `apps/web/app/analytics/page.tsx`

**Step 1: Add charts**

```tsx
{/* Daily cost + API key usage */}
<section className="analytics-grid">
  <div className="analytics-cell span-8">
    <h3>Daily Cost / {RANGE_LABELS[range]}</h3>
    <div style={{height:220}}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={stats?.dailyBreakdown ?? []}>
          <CartesianGrid stroke="#252525" vertical={false} />
          <XAxis dataKey="date" stroke="#555" fontSize={9} />
          <YAxis stroke="#555" fontSize={9} tickFormatter={(v:number)=>`$${compact(v)}`} />
          <Tooltip contentStyle={{background:"#090b0b",border:"1px solid #444",borderRadius:0,fontSize:11}} formatter={(v:number)=>money(v)} />
          <Bar dataKey="cost" fill="#d4a72c" radius={[2,2,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
  <div className="analytics-cell span-4">
    <h3>API Key Usage / Cost</h3>
    <div className="table-wrap" style={{maxHeight:220,overflowY:"auto"}}>
      <table className="ops-table">
        <thead><tr><th>KEY</th><th>REQ</th><th>COST</th></tr></thead>
        <tbody>
          {(stats?.usageByApiKey ?? []).filter((k) => k.requests > 0).map((k) => (
            <tr key={k.id}>
              <td><b>{k.label}</b></td>
              <td>{compact(k.requests)}</td>
              <td>{money(k.estimatedCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
</section>
```

**Step 2: Commit**

```bash
git add apps/web/app/analytics/page.tsx
git commit -m "feat: daily cost bar chart + API key usage table"
```

---

## Part D: Dashboard Enhancement

### Task D1: Add alltime KPI row to existing dashboard

**Objective:** The current dashboard only shows today's stats. Add an alltime summary strip below the existing KPI strip.

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`

**Step 1: Add alltime strip**

After the existing `<section className="kpi-strip">` block, add:

```tsx
{stats?.alltimeSummary && (
  <section className="kpi-strip kpi-alltime">
    <Ledger className="ops-ledger" size="sm" label="◈ ALLTIME REQUESTS" value={stats.alltimeSummary.totalRequests} />
    <Ledger className="ops-ledger" size="sm" label="◈ ALLTIME TOKENS" value={stats.alltimeSummary.totalTokens} />
    <Ledger className="ops-ledger" size="sm" label="◈ ALLTIME COST" value={stats.alltimeSummary.totalCost} format="currency" decimals={2} />
    <Ledger className="ops-ledger" size="sm" label="◈ AVG DAILY COST" value={stats.alltimeSummary.avgDailyCost} format="currency" decimals={2} />
    <Ledger className="ops-ledger" size="sm" label="◈ ACTIVE SINCE" value={stats.alltimeSummary.dateRange.earliest ? new Date(stats.alltimeSummary.dateRange.earliest).toLocaleDateString() : 0} format="number" />
    <Ledger className="ops-ledger" size="sm" label="◈ RETAIL VALUE" value={modelRows.reduce((s,r)=>s+r.retail,0)} format="currency" decimals={2} />
  </section>
)}
```

**Step 2: Add CSS**

```css
.kpi-alltime{background:var(--bg-surface)}
.kpi-alltime .ops-ledger{background:color-mix(in srgb,var(--accent-subtle) 30%,var(--bg-surface))!important}
```

**Step 3: Update Stats interface**

Add `alltimeSummary` to the Stats interface in dashboard/page.tsx:

```typescript
interface Stats {
  // ... existing fields ...
  alltimeSummary?: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgDailyCost: number;
    dateRange: { earliest: string | null; latest: string | null };
  };
  dailyBreakdown?: { date: string; requests: number; errors: number; tokens: number; cost: number; inputTokens: number; outputTokens: number }[];
}
```

**Step 4: Commit**

```bash
git add apps/web/app/dashboard/page.tsx apps/web/app/globals.css
git commit -m "feat: alltime KPI strip on dashboard"
```

---

### Task D2: Add token flow mini-chart and provider health probe button to dashboard

**Objective:** Add a compact token velocity chart (tokens/hour) and a "Probe Health" button to the existing dashboard's provider health section.

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`

**Step 1: Add token velocity to chart**

In the existing request velocity chart section, add a second Area for tokens:

```tsx
// Add to the AreaChart's existing chart after the errors Area:
<Area type="stepAfter" dataKey="totalTokens" stroke="#4dabf7" fill="transparent" strokeWidth={1} yAxisId="tokens" />
```

Add a second YAxis:

```tsx
<YAxis yAxisId="tokens" orientation="right" stroke="#4dabf7" fontSize={9} tickFormatter={compact} />
```

**Step 2: Add health probe button**

In the provider health section, add a button that calls the health probe endpoint and refreshes:

```tsx
// Add to the health column header area:
<button className="control-button" onClick={async () => {
  try {
    await apiFetch("/admin/health/probe", { method: "POST" });
    const h = await apiFetch<HealthStatus>("/admin/health");
    setHealthStatus(h);
  } catch {}
}} style={{ marginLeft: "auto", marginRight: 8, marginBottom: 4 }}>
  PROBE
</button>
```

Add state:

```tsx
const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
```

Add to the `load` callback:

```tsx
// In Promise.all:
apiFetch<HealthStatus>("/admin/health")
```

**Step 3: Commit**

```bash
git add apps/web/app/dashboard/page.tsx
git commit -m "feat: token velocity overlay + health probe button on dashboard"
```

---

## Part E: Build, Deploy, Verify

### Task E1: Full typecheck and build

**Objective:** Ensure the entire monorepo compiles.

**Step 1: Typecheck**

```bash
cd /home/samuel/AiApi-Wrapper
pnpm typecheck
```
Expected: no errors

**Step 2: Build API**

```bash
pnpm --filter @model-console/api build
```
Expected: compiles to `apps/api/dist/`

**Step 3: Build Web**

```bash
pnpm --filter @model-console/web build
```
Expected: Next.js build succeeds

**Step 4: Commit if any fixes needed**

---

### Task E2: Restart services and verify live

**Objective:** Deploy the changes to the running services and verify everything works.

**Step 1: Find and restart API process**

```bash
# Kill old API process
kill $(pgrep -f "AiApi-Wrapper/apps/api/dist/server.js")
# Start new
cd /home/samuel/AiApi-Wrapper
node apps/api/dist/server.js &
```

**Step 2: Restart web**

```bash
# Kill old next-server for this project
kill $(pgrep -f "next-server.*3100")
# Start new
cd /home/samuel/AiApi-Wrapper/apps/web
npm exec next start -- -p 3100 &
```

**Step 3: Health checks**

```bash
curl -s http://127.0.0.1:18789/health | jq .
curl -s http://127.0.0.1:3100/dashboard -o /dev/null -w "%{http_code}"
curl -s http://127.0.0.1:3100/analytics -o /dev/null -w "%{http_code}"
```

**Step 4: Verify API endpoints**

```bash
# Stats with range
curl -s http://127.0.0.1:18789/admin/stats?range=7d -H "Cookie: admin_session=..." | jq '.alltimeSummary'
# Cost breakdown
curl -s http://127.0.0.1:18789/admin/stats/cost-breakdown?range=7d -H "Cookie: admin_session=..." | jq '.providers'
# Health
curl -s http://127.0.0.1:18789/admin/health -H "Cookie: admin_session=..." | jq '.overall'
```

---

## Risks & Tradeoffs

1. **Provider probing costs tokens** — Each probe uses ~5 output tokens. At 3 providers × every 5 min = ~520 probes/day ≈ negligible cost (~$0.01/day on retail pricing, $0 on subscription).

2. **SQLite scan performance** — The stats endpoint loads ALL requests into memory (41k rows). This works now but will get slow at 500k+ rows. Mitigation: add indexes on `created_at`, `provider`, `model_alias`. Future: add pre-aggregated daily summary table.

3. **Alltime stats endpoint is heavy** — Computing alltime aggregations over 41k rows on every request. Mitigation: cache the alltime summary for 5 minutes (simple in-memory TTL cache in the route handler).

4. **Cost figures are retail-value estimates** — Z.AI and Gemini are on subscription plans (coding plan, free tier), so the $2006 "cost" is what it WOULD cost at retail API rates, not actual spend. This is already how the system works — the plan maintains this convention.

5. **No auth on health probe POST** — Protected by `requireAdminAuth`, same as all admin endpoints. Safe.

## Open Questions

- Should we add a monthly cost projection (extrapolated from current rate)?
- Should the health probe system support per-model probing (not just per-provider)?
- Should we add a "export to CSV" button for analytics data?
- Should the alltime summary be cached server-side to avoid recomputing on every page load?
