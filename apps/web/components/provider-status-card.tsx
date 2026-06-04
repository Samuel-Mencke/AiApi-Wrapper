"use client";

import { useState } from "react";
import { Activity, Gauge, Loader2, Power, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/table";

export interface ProviderRow {
  id: string;
  name: string;
  type: string;
  baseUrl?: string | null;
  enabled: boolean;
  createdAt: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export function ProviderStatusCard({
  provider,
  quotaEnabled,
  onChanged,
  onQuotaToggle
}: {
  provider: ProviderRow;
  quotaEnabled: boolean;
  onChanged: () => void;
  onQuotaToggle: (enabled: boolean) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function testProvider() {
    setTesting(true);
    setResult(null);
    try {
      const res = await apiFetch<TestResult>("/admin/providers/test", {
        method: "POST",
        body: JSON.stringify({ provider: provider.name })
      });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function toggle() {
    await apiFetch(`/admin/providers/${provider.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !provider.enabled })
    });
    onChanged();
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-zinc-100">{provider.name}</div>
          <div className="mt-1 text-sm text-zinc-500">{provider.baseUrl ?? "Default provider endpoint"}</div>
        </div>
        <Badge className={provider.enabled ? "border-blue-500/30 text-blue-200" : "border-zinc-700 text-zinc-500"}>
          {provider.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      {result ? (
        <div className={`mt-4 rounded-xl border p-3 text-sm ${result.ok ? "border-green-500/30 bg-green-500/5 text-green-200" : "border-red-500/30 bg-red-500/5 text-red-200"}`}>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            <span className="font-medium">{result.ok ? "Success" : "Failed"}</span>
            {result.latencyMs != null && (
              <span className="ml-auto text-xs text-zinc-400">{result.latencyMs}ms</span>
            )}
          </div>
          <div className="mt-1 text-xs text-zinc-400 break-all">{result.message}</div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs uppercase text-zinc-500">{provider.type}</div>
        <div className="flex gap-2">
          <Button variant={quotaEnabled ? "secondary" : "ghost"} onClick={() => onQuotaToggle(!quotaEnabled)}>
            <Gauge className="h-4 w-4" />
            Quota
          </Button>
          <Button variant="secondary" onClick={testProvider} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {testing ? "Testing..." : "Test"}
          </Button>
          <Button variant="ghost" onClick={toggle}>
            <Power className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
