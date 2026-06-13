"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, Play, Trash2, X } from "lucide-react";
import { Badge, Table, Td, Th } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

export interface ModelRouteFallback {
  provider: string;
  model: string;
  baseUrl?: string;
}

export interface ModelRouteRow {
  id: string;
  alias: string;
  provider: string;
  realModel: string;
  enabled: boolean;
  fallback?: ModelRouteFallback[];
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

interface Draft {
  alias: string;
  provider: string;
  realModel: string;
  fallbackText: string;
}

function fallbackToText(fallback: ModelRouteFallback[] | undefined) {
  return (fallback ?? []).map((item) => `${item.provider}/${item.model}${item.baseUrl ? ` ${item.baseUrl}` : ""}`).join("\n");
}

function textToFallback(value: string): ModelRouteFallback[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [target = "", baseUrl] = line.split(/\s+/, 2);
      const [provider, model] = target.split("/", 2);
      return {
        provider: provider ?? "",
        model: model ?? "",
        baseUrl
      };
    })
    .filter((item) => item.provider && item.model);
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
      setTimeout(() => setResult(null), 6000);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" className="h-8 w-8 p-0" onClick={test} disabled={testing} title="Test model route">
        {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
      </Button>
      {result ? (
        <span className={`max-w-36 truncate text-xs ${result.ok ? "text-green-400" : "text-red-400"}`} title={result.message}>
          {result.ok ? `${result.latencyMs}ms` : result.message}
        </span>
      ) : null}
    </div>
  );
}

export function ModelRoutesTable({
  data,
  providers,
  onChanged
}: {
  data: ModelRouteRow[];
  providers: string[];
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ alias: "", provider: "", realModel: "", fallbackText: "" });

  function startEdit(row: ModelRouteRow) {
    setPendingDeleteId(null);
    setEditingId(row.id);
    setDraft({
      alias: row.alias,
      provider: row.provider,
      realModel: row.realModel,
      fallbackText: fallbackToText(row.fallback)
    });
  }

  async function save(row: ModelRouteRow) {
    await apiFetch(`/admin/models/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        alias: draft.alias.trim(),
        provider: draft.provider,
        realModel: draft.realModel.trim(),
        fallback: textToFallback(draft.fallbackText),
        enabled: row.enabled
      })
    });
    setEditingId(null);
    onChanged();
  }

  async function toggle(row: ModelRouteRow) {
    await apiFetch(`/admin/models/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !row.enabled })
    });
    onChanged();
  }

  async function remove(row: ModelRouteRow) {
    if (pendingDeleteId !== row.id) {
      setPendingDeleteId(row.id);
      setEditingId(null);
      return;
    }
    await apiFetch(`/admin/models/${row.id}`, { method: "DELETE" });
    setPendingDeleteId(null);
    onChanged();
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <thead>
          <tr>
            <Th>Alias</Th>
            <Th>Provider</Th>
            <Th>Real model</Th>
            <Th>Status</Th>
            <Th>Fallbacks</Th>
            <Th>Health</Th>
            <Th>Test</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const editing = editingId === row.id;
            return (
              <tr key={row.id}>
                <Td>
                  {editing ? (
                    <Input
                      className="h-8 min-w-40"
                      value={draft.alias}
                      onChange={(event) => setDraft((value) => ({ ...value, alias: event.target.value }))}
                    />
                  ) : row.alias}
                </Td>
                <Td>
                  {editing ? (
                    <select
                      className="h-8 min-w-36 rounded-lg border border-white/[0.07] bg-[#101010] px-2 text-sm text-zinc-100 outline-none"
                      value={draft.provider}
                      onChange={(event) => setDraft((value) => ({ ...value, provider: event.target.value }))}
                    >
                      {providers.map((provider) => (
                        <option key={provider} value={provider}>{provider}</option>
                      ))}
                    </select>
                  ) : row.provider}
                </Td>
                <Td>
                  {editing ? (
                    <Input
                      className="h-8 min-w-48"
                      value={draft.realModel}
                      onChange={(event) => setDraft((value) => ({ ...value, realModel: event.target.value }))}
                    />
                  ) : row.realModel}
                </Td>
                <Td>
                  <Badge className={row.enabled ? "border-[#3ddc97]/25 bg-[#3ddc97]/10 text-[#82efbf]" : ""}>
                    {row.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </Td>
                <Td>
                  {editing ? (
                    <textarea
                      className="min-h-20 w-64 rounded-lg border border-white/[0.07] bg-[#101010] px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/[0.18]"
                      placeholder="provider/model per line"
                      value={draft.fallbackText}
                      onChange={(event) => setDraft((value) => ({ ...value, fallbackText: event.target.value }))}
                    />
                  ) : (
                    row.fallbackCount || "None"
                  )}
                </Td>
                <Td>
                  <div className="whitespace-nowrap text-xs text-zinc-400">
                    {row.avgLatencyMs ? `${row.avgLatencyMs}ms` : "No traffic"} · {Math.round(row.errorRate * 100)}% err
                  </div>
                </Td>
                <Td><TestButton alias={row.alias} /></Td>
                <Td>
                  <div className="flex min-w-80 gap-2">
                    {editing ? (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => save(row)}
                          disabled={!draft.alias.trim() || !draft.provider || !draft.realModel.trim()}
                        >
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
                        <Button variant="danger" onClick={() => remove(row)}>
                          <Trash2 className="h-4 w-4" />
                          {pendingDeleteId === row.id ? "Confirm" : ""}
                        </Button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
          {!data.length ? (
            <tr>
              <Td colSpan={8} className="py-8 text-center text-zinc-500">No model routes found.</Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
  );
}
