"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { ProviderStatusCard, type ProviderRow } from "@/components/provider-status-card";
import { apiFetch, type ApiEnvelope } from "@/lib/api";

interface QuotaSetting {
  id: string;
  provider: string;
  modelAlias: string;
  enabled: boolean;
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [quotaSettings, setQuotaSettings] = useState<QuotaSetting[]>([]);
  const [error, setError] = useState("");

  function load() {
    Promise.all([
      apiFetch<ApiEnvelope<ProviderRow[]>>("/admin/providers"),
      apiFetch<ApiEnvelope<QuotaSetting[]>>("/admin/quota-settings")
    ])
      .then(([providerResult, quotaResult]) => {
        setProviders(providerResult.data);
        setQuotaSettings(quotaResult.data);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Providers</h1>
          <p className="mt-1 text-sm text-zinc-500">Configured provider endpoints and reachability checks.</p>
        </div>
        {error ? <div className="text-sm text-red-300">{error}</div> : null}
        <div className="grid grid-cols-3 gap-4">
          {providers.map((provider) => (
            <ProviderStatusCard
              key={provider.id}
              provider={provider}
              quotaEnabled={quotaSettings.some((setting) => setting.provider === provider.name && setting.enabled)}
              onChanged={load}
              onQuotaToggle={async (enabled) => {
                await apiFetch("/admin/quota-settings", {
                  method: "PATCH",
                  body: JSON.stringify({ provider: provider.name, enabled })
                });
                load();
              }}
            />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
