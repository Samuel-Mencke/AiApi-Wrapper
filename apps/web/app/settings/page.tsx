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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<Settings>("/admin/settings").then(setSettings).catch((err: Error) => setError(err.message));
  }, []);

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Settings</h1>
          <p className="mt-1 text-sm text-zinc-500">Runtime config and environment health.</p>
        </div>
        {error ? <div className="text-sm text-red-300">{error}</div> : null}
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
              <div className="text-sm text-zinc-500">Loading environment...</div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
