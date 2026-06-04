"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge, Table, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

export interface LogRow {
  id: string;
  apiKeyId?: string | null;
  modelAlias: string;
  provider: string;
  realModel: string;
  status: string;
  latencyMs: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export function LogsTable({ data }: { data: LogRow[] }) {
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const value = filter.toLowerCase();
    return data.filter((row) => JSON.stringify(row).toLowerCase().includes(value));
  }, [data, filter]);

  return (
    <div className="space-y-4">
      <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter time, key, model, provider, status, error" />
      <Table>
        <thead>
          <tr>
            <Th>Time</Th>
            <Th>API key</Th>
            <Th>Model</Th>
            <Th>Provider</Th>
            <Th>Status</Th>
            <Th>Latency</Th>
            <Th>Error</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <Td>{formatDate(row.createdAt)}</Td>
              <Td>{row.apiKeyId ?? "master"}</Td>
              <Td>{row.modelAlias}</Td>
              <Td>{row.provider}</Td>
              <Td><Badge>{row.status}</Badge></Td>
              <Td>{row.latencyMs} ms</Td>
              <Td>{row.errorCode ? `${row.errorCode}: ${row.errorMessage}` : "None"}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
