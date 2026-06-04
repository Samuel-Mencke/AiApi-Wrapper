"use client";

import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge, Table, Td, Th } from "@/components/ui/table";

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
