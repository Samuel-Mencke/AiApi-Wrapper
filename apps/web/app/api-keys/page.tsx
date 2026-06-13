"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, KeyRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiKeyTable, type ApiKeyRow } from "@/components/api-key-table";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, type ApiEnvelope } from "@/lib/api";

const schema = z.object({
  name: z.string().min(1),
  monthlyLimit: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().positive().optional())
});

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [newKey, setNewKey] = useState("");
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  function load() {
    apiFetch<ApiEnvelope<ApiKeyRow[]>>("/admin/api-keys")
      .then((result) => setKeys(result.data))
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  async function create(values: z.infer<typeof schema>) {
    const result = await apiFetch<ApiKeyRow & { key: string }>("/admin/api-keys", {
      method: "POST",
      body: JSON.stringify(values)
    });
    setNewKey(result.key);
    form.reset();
    load();
  }

  async function copyNewKey() {
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const filteredKeys = keys.filter((key) => {
    const text = `${key.name} ${key.enabled ? "enabled" : "disabled"}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">API Keys</h1>
          <p className="mt-1 text-sm text-zinc-500">Gateway keys are hashed at rest and revealed only on creation.</p>
        </div>
        {error ? <div className="text-sm text-[#ff9aad]">{error}</div> : null}
        {newKey ? (
          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-100">New key</div>
                  <div className="mt-1 text-xs text-zinc-500">Copy it now. It will not be shown again.</div>
                </div>
                <Button variant="secondary" onClick={copyNewKey} type="button">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="mt-3 break-all rounded-lg border border-white/[0.06] bg-[#111111] p-3 font-mono text-sm text-zinc-100">{newKey}</div>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader><CardTitle>Create key</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px_auto]" onSubmit={form.handleSubmit(create)}>
              <Input placeholder="Name" {...form.register("name")} />
              <Input placeholder="Monthly limit" type="number" {...form.register("monthlyLimit")} />
              <Button><KeyRound className="h-4 w-4" /> Create</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Manage keys</CardTitle>
            <Input
              className="sm:w-72"
              placeholder="Search keys"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </CardHeader>
          <CardContent>
            <ApiKeyTable data={filteredKeys} onChanged={load} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
