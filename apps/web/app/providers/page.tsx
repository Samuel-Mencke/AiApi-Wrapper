"use client";

import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { ProviderStatusCard, type ProviderRow } from "@/components/provider-status-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/table";
import { apiFetch, type ApiEnvelope } from "@/lib/api";
import { formatNumber } from "@/lib/utils";

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

interface ProviderQuotaSummary {
  provider: string;
  routeCount: number;
  enabled: boolean;
  windowHours: number;
  requestLimit: number | null;
  tokenLimit: number | null;
}

const PROVIDER_QUOTA_ALIAS = "__provider__";

function providerQuota(provider: ProviderRow, settings: QuotaSetting[]): ProviderQuotaSummary {
  const providerSettings = settings.filter((setting) => setting.provider === provider.name);
  const providerSetting = providerSettings.find((setting) => setting.modelAlias === PROVIDER_QUOTA_ALIAS);
  const routeSettings = providerSettings.filter((setting) => setting.modelAlias !== PROVIDER_QUOTA_ALIAS);
  return {
    provider: provider.name,
    routeCount: routeSettings.length,
    enabled: providerSetting?.enabled ?? false,
    windowHours: providerSetting?.windowHours ?? 5,
    requestLimit: providerSetting?.requestLimit ?? null,
    tokenLimit: providerSetting?.tokenLimit ?? null
  };
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

  const providerQuotas = useMemo(
    () => providers.map((provider) => providerQuota(provider, quotaSettings)),
    [providers, quotaSettings]
  );

  async function patchProviderQuota(provider: string, body: Partial<Pick<QuotaSetting, "enabled" | "windowHours" | "requestLimit" | "tokenLimit">>) {
    const result = await apiFetch<ApiEnvelope<QuotaSetting[]>>("/admin/quota-settings", {
      method: "PATCH",
      body: JSON.stringify({ provider, ...body })
    });
    setQuotaSettings(result.data);
  }

  function numberInput(id: string): number | null {
    const input = document.getElementById(id) as HTMLInputElement | null;
    return input?.value ? Number(input.value) : null;
  }

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Providers</h1>
          <p className="mt-1 text-sm text-zinc-500">Configured provider endpoints and reachability checks.</p>
        </div>
        {error ? <div className="text-sm text-[#ff9aad]">{error}</div> : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {providers.map((provider) => (
            <ProviderStatusCard
              key={provider.id}
              provider={provider}
              quotaEnabled={quotaSettings.some(
                (setting) => setting.provider === provider.name && setting.modelAlias === PROVIDER_QUOTA_ALIAS && setting.enabled
              )}
              onChanged={load}
              onQuotaToggle={async (enabled) => {
                await patchProviderQuota(provider.name, { enabled });
              }}
            />
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Provider quotas</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {providerQuotas.map((quota) => (
              <div key={quota.provider} className="space-y-4 rounded-xl border border-white/[0.06] bg-[#121212] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{quota.provider}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {quota.routeCount ? `${formatNumber(quota.routeCount)} model routes covered` : "Provider-level quota"}
                    </div>
                  </div>
                  <Badge className={quota.enabled ? "border-[#3ddc97]/25 bg-[#3ddc97]/10 text-[#82efbf]" : ""}>
                    {quota.enabled ? "Quota enabled" : "Quota off"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[1fr_1fr_1fr_auto_auto]">
                  <Input
                    id={`quota-window-${quota.provider}`}
                    type="number"
                    min={1}
                    placeholder="Window hours"
                    defaultValue={quota.windowHours}
                  />
                  <Input
                    id={`quota-requests-${quota.provider}`}
                    type="number"
                    min={1}
                    placeholder="Request limit"
                    defaultValue={quota.requestLimit ?? ""}
                  />
                  <Input
                    id={`quota-tokens-${quota.provider}`}
                    type="number"
                    min={1}
                    placeholder="Token limit"
                    defaultValue={quota.tokenLimit ?? ""}
                  />
                  <Button
                    variant={quota.enabled ? "secondary" : "ghost"}
                    onClick={() => patchProviderQuota(quota.provider, { enabled: !quota.enabled })}
                  >
                    {quota.enabled ? "On" : "Off"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      patchProviderQuota(quota.provider, {
                        windowHours: numberInput(`quota-window-${quota.provider}`) ?? 5,
                        requestLimit: numberInput(`quota-requests-${quota.provider}`),
                        tokenLimit: numberInput(`quota-tokens-${quota.provider}`)
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
