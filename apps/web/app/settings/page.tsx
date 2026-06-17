"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useTheme, THEME_PRESETS } from "@/components/theme-provider";
import { apiFetch } from "@/lib/api";

interface Settings {
  publicBaseUrl: string;
  apiPort: number;
  dashboardUrl: string;
  configSource: string;
  promptLogging: boolean;
  environmentHealth: {
    database: string;
    adminAuth: string;
    publicApiAuth: string;
  };
}

interface QuotaStatus {
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

function ThemeCard({ preset, active, onSelect }: {
  preset: typeof THEME_PRESETS[number];
  active: boolean;
  onSelect: () => void;
}) {
  const c = preset.colors;
  return (
    <button
      onClick={onSelect}
      className="group relative overflow-hidden rounded-xl border transition-all"
      style={{
        background: c.bgSurface,
        borderColor: active ? c.accent : c.borderDefault,
        boxShadow: active ? `0 0 0 2px ${c.accent}40` : "none"
      }}
    >
      {/* Preview swatches */}
      <div className="flex h-16 gap-1 p-2" style={{ background: c.bgBase }}>
        <div className="flex flex-1 flex-col gap-1 rounded-md p-1.5" style={{ background: c.bgSurface }}>
          <div className="h-1.5 w-8 rounded-full" style={{ background: c.textSecondary }} />
          <div className="h-1.5 w-6 rounded-full" style={{ background: c.textMuted }} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="h-4 w-4 rounded-full" style={{ background: c.accent }} />
          <div className="h-4 w-4 rounded-full" style={{ background: c.textPrimary }} />
        </div>
      </div>
      {/* Label */}
      <div className="px-2.5 py-2 text-left">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs font-medium truncate" style={{ color: c.textPrimary }}>{preset.name}</span>
          {active && <Check className="h-3 w-3 shrink-0" style={{ color: c.accent }} />}
        </div>
      </div>
    </button>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [error, setError] = useState("");
  const { themeId, setThemeId, saveTheme, saving, saved } = useTheme();

  useEffect(() => {
    apiFetch<Settings>("/admin/settings").then(setSettings).catch((err: Error) => setError(err.message));
    apiFetch<QuotaStatus>("/admin/quota").then(setQuota).catch((err: Error) => setError(err.message));
  }, []);

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#ece9e4]">Settings</h1>
          <p className="mt-1 text-sm text-[#807a6f]">Appearance, runtime config and environment health.</p>
        </div>
        {error ? <div className="text-sm text-[#e08585]">{error}</div> : null}

        {/* Appearance / Theme picker */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <p className="text-sm text-[#807a6f]">Choose a theme — saved to your account and synced across devices.</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {THEME_PRESETS.map((preset) => (
                <ThemeCard
                  key={preset.id}
                  preset={preset}
                  active={themeId === preset.id}
                  onSelect={() => setThemeId(preset.id)}
                />
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button
                disabled={saving}
                onClick={() => saveTheme(themeId)}
                className="h-9 rounded-lg px-4 text-sm"
              >
                {saving ? "Saving..." : saved ? "Saved!" : "Save Theme"}
              </Button>
              {saved && <span className="text-sm text-[#9bc480]">Theme synced to your account.</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Environment</CardTitle></CardHeader>
          <CardContent>
            {settings ? (
              <Table>
                <tbody>
                  <tr><Th>PUBLIC_BASE_URL</Th><Td>{settings.publicBaseUrl}</Td></tr>
                  <tr><Th>API port</Th><Td>{settings.apiPort}</Td></tr>
                  <tr><Th>Dashboard URL</Th><Td>{settings.dashboardUrl}</Td></tr>
                  <tr><Th>Config source</Th><Td>{settings.configSource}</Td></tr>
                  <tr><Th>Prompt logging</Th><Td><Badge>{settings.promptLogging ? "Enabled" : "Disabled"}</Badge></Td></tr>
                  <tr><Th>Database</Th><Td>{settings.environmentHealth.database}</Td></tr>
                  <tr><Th>Dashboard auth</Th><Td><Badge>{settings.environmentHealth.adminAuth}</Badge></Td></tr>
                  <tr><Th>API auth</Th><Td><Badge>{settings.environmentHealth.publicApiAuth}</Badge></Td></tr>
                </tbody>
              </Table>
            ) : (
              <div className="text-sm text-[#807a6f]">Loading environment...</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Z.ai quota</CardTitle></CardHeader>
          <CardContent>
            {quota ? (
              <div className="space-y-5">
                <Table>
                  <tbody>
                    <tr><Th>Provider</Th><Td>{quota.provider}</Td></tr>
                    <tr><Th>Status</Th><Td><Badge>{quota.status}</Badge></Td></tr>
                    <tr><Th>Exact reset from API</Th><Td>{quota.exactProviderResetAt ?? "Not exposed by provider API"}</Td></tr>
                    <tr><Th>Estimated 5h reset</Th><Td>{quota.estimatedFiveHourResetAt ?? "No local quota error seen"}</Td></tr>
                    <tr><Th>Weekly reset</Th><Td>{quota.weeklyResetAt ?? "Depends on subscription activation date"}</Td></tr>
                  </tbody>
                </Table>
                {quota.lastQuotaEvent ? (
                  <div className="rounded-xl border border-white/[0.06] bg-[#1a1a19] p-4">
                    <div className="text-sm font-medium text-[#ece9e4]">Last quota event</div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-sm text-[#807a6f]">
                      <div>Time: {quota.lastQuotaEvent.createdAt}</div>
                      <div>Model: {quota.lastQuotaEvent.modelAlias}</div>
                      <div>Error: {quota.lastQuotaEvent.errorCode ?? "unknown"}</div>
                      <div>Reset estimate: {quota.lastQuotaEvent.estimatedFiveHourResetAt ?? "unknown"}</div>
                    </div>
                    <div className="mt-2 text-sm text-[#807a6f]">{quota.lastQuotaEvent.errorMessage}</div>
                  </div>
                ) : null}
                <div className="space-y-2 text-sm text-[#807a6f]">
                  {quota.notes.map((note) => <p key={note}>{note}</p>)}
                  <a className="text-[#b8b3a8] hover:text-[#ece9e4]" href="https://z.ai/manage-apikey/subscription" target="_blank" rel="noreferrer">
                    Open Z.ai usage statistics
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-sm text-[#807a6f]">Loading quota status...</div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
