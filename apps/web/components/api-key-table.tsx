"use client";

import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", monthlyLimit: "" });

  function startEdit(row: ApiKeyRow) {
    setEditingId(row.id);
    setPendingDeleteId(null);
    setDraft({
      name: row.name,
      monthlyLimit: row.monthlyLimit?.toString() ?? ""
    });
  }

  async function save(row: ApiKeyRow) {
    await apiFetch(`/admin/api-keys/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: draft.name.trim(),
        monthlyLimit: draft.monthlyLimit ? Number(draft.monthlyLimit) : null
      })
    });
    setEditingId(null);
    onChanged();
  }

  async function remove(id: string) {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    await apiFetch(`/admin/api-keys/${id}`, { method: "DELETE" });
    setPendingDeleteId(null);
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
    <div className="overflow-x-auto">
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
            <Td>
              {editingId === row.id ? (
                <Input
                  className="h-8 min-w-44"
                  value={draft.name}
                  onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
                />
              ) : (
                row.name
              )}
            </Td>
            <Td>{formatDate(row.createdAt)}</Td>
            <Td>{formatDate(row.lastUsedAt)}</Td>
            <Td><Badge>{row.enabled ? "Enabled" : "Disabled"}</Badge></Td>
            <Td>
              {editingId === row.id ? (
                <Input
                  className="h-8 w-36"
                  type="number"
                  min={1}
                  placeholder="Unlimited"
                  value={draft.monthlyLimit}
                  onChange={(event) => setDraft((value) => ({ ...value, monthlyLimit: event.target.value }))}
                />
              ) : (
                row.monthlyLimit ?? "Unlimited"
              )}
            </Td>
            <Td>
              <div className="flex min-w-72 gap-2">
                {editingId === row.id ? (
                  <>
                    <Button variant="secondary" onClick={() => save(row)} disabled={!draft.name.trim()}>
                      <Check className="h-4 w-4" />
                      Save
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => toggle(row)}>{row.enabled ? "Disable" : "Enable"}</Button>
                    <Button variant="ghost" onClick={() => startEdit(row)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="danger" onClick={() => remove(row.id)}>
                      <Trash2 className="h-4 w-4" />
                      {pendingDeleteId === row.id ? "Confirm" : ""}
                    </Button>
                  </>
                )}
              </div>
            </Td>
          </tr>
        ))}
        {!data.length ? (
          <tr>
            <Td colSpan={6} className="py-8 text-center text-[var(--text-muted)]">No API keys found.</Td>
          </tr>
        ) : null}
      </tbody>
    </Table>
    </div>
  );
}
