"use client";

import { Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Table, Td, Th } from "@/components/ui/table";

export interface ApiKeyRow {
  id: string;
  name: string;
  enabled: boolean;
  monthlyLimit?: number | null;
  createdAt: string;
  lastUsedAt?: string | null;
}

export function ApiKeyTable({ data, onChanged }: { data: ApiKeyRow[]; onChanged: () => void }) {
  async function remove(id: string) {
    await apiFetch(`/admin/api-keys/${id}`, { method: "DELETE" });
    onChanged();
  }

  async function toggle(row: ApiKeyRow) {
    await apiFetch(`/admin/api-keys/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !row.enabled })
    });
    onChanged();
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Created</Th>
          <Th>Last used</Th>
          <Th>Status</Th>
          <Th>Monthly limit</Th>
          <Th>Actions</Th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.id}>
            <Td>{row.name}</Td>
            <Td>{formatDate(row.createdAt)}</Td>
            <Td>{formatDate(row.lastUsedAt)}</Td>
            <Td><Badge>{row.enabled ? "Enabled" : "Disabled"}</Badge></Td>
            <Td>{row.monthlyLimit ?? "Unlimited"}</Td>
            <Td>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => toggle(row)}>{row.enabled ? "Disable" : "Enable"}</Button>
                <Button variant="danger" onClick={() => remove(row.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
