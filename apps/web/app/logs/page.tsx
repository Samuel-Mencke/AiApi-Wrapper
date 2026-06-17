"use client";

import { useEffect, useState } from "react";
import { LogsTable, type LogRow } from "@/components/logs-table";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch, type ApiEnvelope } from "@/lib/api";

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<ApiEnvelope<LogRow[]>>("/admin/logs")
      .then((result) => setLogs(result.data))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#ece9e4]">Logs</h1>
          <p className="mt-1 text-sm text-[#807a6f]">Metadata-only request history. Prompts and responses are not displayed.</p>
        </div>
        {error ? <div className="text-sm text-[#e08585]">{error}</div> : null}
        <Card>
          <CardContent>
            <LogsTable data={logs} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
