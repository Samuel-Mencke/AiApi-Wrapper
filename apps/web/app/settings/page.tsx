"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, Table, Td, Th } from "@/components/ui/table";
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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Settings>("/admin/settings").then(setSettings).catch((err: Error) => setError(err.message));
    apiFetch<QuotaStatus>("/admin/quota").then(setQuota).catch((err: Error) => setError(err.message));
  }, []);

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#ece9e4]">Settings</h1>
          <p className="mt-1 text-sm text-[#807a6f]">Runtime config and environment health.</p>
        </div>
        {error ? <div className="text-sm text-[#e08585]">{error}</div> : null}
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
