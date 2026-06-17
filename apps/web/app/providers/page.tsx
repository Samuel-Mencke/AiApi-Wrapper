"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [newProvider, setNewProvider] = useState({
    name: "",
    type: "custom",
    baseUrl: "",
    enabled: true
  });

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

  const visibleProviders = providers.filter((provider) => {
    const text = `${provider.name} ${provider.type} ${provider.baseUrl ?? ""}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

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

  async function createProvider() {
    setError("");
    try {
      await apiFetch("/admin/providers", {
        method: "POST",
        body: JSON.stringify({
          name: newProvider.name.trim(),
          type: newProvider.type,
          baseUrl: newProvider.baseUrl.trim() || null,
          enabled: newProvider.enabled
        })
      });
      setNewProvider({ name: "", type: "custom", baseUrl: "", enabled: true });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#ece9e4]">Providers</h1>
          <p className="mt-1 text-sm text-[#807a6f]">Configured provider endpoints and reachability checks.</p>
        </div>
        {error ? <div className="text-sm text-[#e08585]">{error}</div> : null}

        <Card>
          <CardHeader><CardTitle>Add provider</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_150px_2fr_auto]">
              <Input
                placeholder="Provider name"
                value={newProvider.name}
                onChange={(event) => setNewProvider((value) => ({ ...value, name: event.target.value }))}
              />
              <select
                className="h-9 rounded-lg border border-white/[0.07] bg-[#1f1e1c] px-3 text-sm text-[#ece9e4] outline-none transition focus:border-white/[0.18]"
                value={newProvider.type}
                onChange={(event) => setNewProvider((value) => ({ ...value, type: event.target.value }))}
              >
                <option value="custom">custom</option>
                <option value="openai">openai</option>
                <option value="openrouter">openrouter</option>
                <option value="gemini">gemini</option>
                <option value="anthropic">anthropic</option>
              </select>
              <Input
                placeholder="Base URL"
                value={newProvider.baseUrl}
                onChange={(event) => setNewProvider((value) => ({ ...value, baseUrl: event.target.value }))}
              />
              <Button onClick={createProvider} disabled={!newProvider.name.trim() || (newProvider.type === "custom" && !newProvider.baseUrl.trim())}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Manage providers</CardTitle>
            <Input
              className="sm:w-80"
              placeholder="Search providers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {visibleProviders.map((provider) => (
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
              onDeleted={load}
            />
          ))}
          {!visibleProviders.length ? (
            <div className="rounded-lg border border-dashed border-white/[0.08] p-8 text-center text-sm text-[#807a6f] xl:col-span-3">
              No providers found.
            </div>
          ) : null}
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
                    <div className="text-sm font-medium text-[#ece9e4]">{quota.provider}</div>
                    <div className="mt-1 text-xs text-[#807a6f]">
                      {quota.routeCount ? `${formatNumber(quota.routeCount)} model routes covered` : "Provider-level quota"}
                    </div>
                  </div>
                  <Badge className={quota.enabled ? "border-[#7aab5e]/25 bg-[#7aab5e]/10 text-[#9bc480]" : ""}>
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
