"use client";

import { useEffect, useState } from "react";
import { Activity, Check, Gauge, Loader2, Pencil, Power, Trash2, X, Zap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/table";

export interface ProviderRow {
  id: string;
  name: string;
  type: string;
  baseUrl?: string | null;
  enabled: boolean;
  createdAt: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export function ProviderStatusCard({
  provider,
  quotaEnabled,
  onChanged,
  onQuotaToggle,
  onDeleted
}: {
  provider: ProviderRow;
  quotaEnabled: boolean;
  onChanged: () => void;
  onQuotaToggle: (enabled: boolean) => void;
  onDeleted: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    name: provider.name,
    type: provider.type,
    baseUrl: provider.baseUrl ?? ""
  });

  useEffect(() => {
    if (!editing) {
      setDraft({
        name: provider.name,
        type: provider.type,
        baseUrl: provider.baseUrl ?? ""
      });
    }
  }, [editing, provider.baseUrl, provider.name, provider.type]);

  async function testProvider() {
    setTesting(true);
    setResult(null);
    try {
      const res = await apiFetch<TestResult>("/admin/providers/test", {
        method: "POST",
        body: JSON.stringify({ provider: provider.name })
      });
      setResult(res);
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function toggle() {
    await apiFetch(`/admin/providers/${provider.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !provider.enabled })
    });
    onChanged();
  }

  async function save() {
    setError("");
    try {
      await apiFetch(`/admin/providers/${provider.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name.trim(),
          type: draft.type,
          baseUrl: draft.baseUrl.trim() || null
        })
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function remove() {
    setError("");
    if (!pendingDelete) {
      setPendingDelete(true);
      setEditing(false);
      return;
    }
    try {
      await apiFetch(`/admin/providers/${provider.id}`, { method: "DELETE" });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPendingDelete(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[var(--bg-elevated)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Input
                className="h-8"
                value={draft.name}
                onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr]">
                <select
                  className="h-8 rounded-lg border border-white/[0.07] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-primary)] outline-none"
                  value={draft.type}
                  onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value }))}
                >
                  <option value="openai">openai</option>
                  <option value="openrouter">openrouter</option>
                  <option value="gemini">gemini</option>
                  <option value="anthropic">anthropic</option>
                  <option value="custom">custom</option>
                </select>
                <Input
                  className="h-8"
                  placeholder="Base URL"
                  value={draft.baseUrl}
                  onChange={(event) => setDraft((value) => ({ ...value, baseUrl: event.target.value }))}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="font-medium text-[var(--text-primary)]">{provider.name}</div>
              <div className="mt-1 break-all text-sm text-[var(--text-muted)]">{provider.baseUrl ?? "Default provider endpoint"}</div>
            </>
          )}
        </div>
        <Badge className={provider.enabled ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent-text)]" : "border-white/[0.06] text-[var(--text-muted)]"}>
          {provider.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-sm text-[var(--danger)]">{error}</div>
      ) : null}

      {result ? (
        <div className={`mt-4 rounded-xl border p-3 text-sm ${result.ok ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent-text)]" : "border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]"}`}>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            <span className="font-medium">{result.ok ? "Success" : "Failed"}</span>
            {result.latencyMs != null && (
              <span className="ml-auto text-xs text-[var(--text-muted)]">{result.latencyMs}ms</span>
            )}
          </div>
          <div className="mt-1 break-all text-xs text-[var(--text-muted)]">{result.message}</div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs uppercase text-[var(--text-muted)]">{provider.type}</div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="secondary" onClick={save} disabled={!draft.name.trim()}>
                <Check className="h-4 w-4" />
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button variant={quotaEnabled ? "secondary" : "ghost"} onClick={() => onQuotaToggle(!quotaEnabled)}>
                <Gauge className="h-4 w-4" />
                Quota
              </Button>
              <Button variant="secondary" onClick={testProvider} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                {testing ? "Testing..." : "Test"}
              </Button>
              <Button variant="ghost" onClick={toggle} title={provider.enabled ? "Disable provider" : "Enable provider"}>
                <Power className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => { setEditing(true); setPendingDelete(false); }} title="Edit provider">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="danger" onClick={remove}>
                <Trash2 className="h-4 w-4" />
                {pendingDelete ? "Confirm" : ""}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
