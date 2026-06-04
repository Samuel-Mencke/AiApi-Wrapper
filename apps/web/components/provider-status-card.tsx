"use client";

import { Activity, Gauge, Power } from "lucide-react";
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
  async function testProvider() {
    const result = await apiFetch<{ ok: boolean; message: string }>("/admin/providers/test", {
      method: "POST",
      body: JSON.stringify({ provider: provider.name })
    });
    window.alert(result.message);
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
      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs uppercase text-zinc-500">{provider.type}</div>
        <div className="flex gap-2">
          <Button variant={quotaEnabled ? "secondary" : "ghost"} onClick={() => onQuotaToggle(!quotaEnabled)}>
            <Gauge className="h-4 w-4" />
            Quota
          </Button>
          <Button variant="secondary" onClick={testProvider}>
            <Activity className="h-4 w-4" />
            Test
          </Button>
          <Button variant="ghost" onClick={toggle}>
            <Power className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
