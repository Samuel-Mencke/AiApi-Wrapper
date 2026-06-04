"use client";

import { useState } from "react";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Play } from "lucide-react";
import { Badge, Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";

export interface ModelRouteRow {
  id: string;
  alias: string;
  provider: string;
  realModel: string;
  enabled: boolean;
  fallbackCount: number;
  avgLatencyMs: number;
  errorRate: number;
}

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  tokens?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

function TestButton({ alias }: { alias: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const res = await apiFetch<TestResult>("/admin/models/test", {
        method: "POST",
        body: JSON.stringify({ alias })
      });
      setResult(res);
      // Clear after 5s
      setTimeout(() => setResult(null), 5000);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" className="h-7 w-7 p-0" onClick={test} disabled={testing}>
        {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      {result ? (
        <span className={`text-xs ${result.ok ? "text-green-400" : "text-red-400"}`}>
          {result.ok ? `${result.latencyMs}ms` : "err"}
        </span>
      ) : null}
    </div>
  );
}

const columns: ColumnDef<ModelRouteRow>[] = [
  { accessorKey: "alias", header: "Alias" },
  { accessorKey: "provider", header: "Provider" },
  { accessorKey: "realModel", header: "Real model" },
  {
    accessorKey: "enabled",
    header: "Status",
    cell: ({ row }) => <Badge>{row.original.enabled ? "Enabled" : "Disabled"}</Badge>
  },
  { accessorKey: "fallbackCount", header: "Fallbacks" },
  { accessorKey: "avgLatencyMs", header: "Avg latency" },
  {
    accessorKey: "errorRate",
    header: "Error rate",
    cell: ({ row }) => `${Math.round(row.original.errorRate * 100)}%`
  },
  {
    id: "test",
    header: "Test",
    cell: ({ row }) => <TestButton alias={row.original.alias} />
  }
];

export function ModelRoutesTable({ data }: { data: ModelRouteRow[] }) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <Table>
      <thead>
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <Th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</Th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <Td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
