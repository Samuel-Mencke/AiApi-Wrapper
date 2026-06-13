"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageShell } from "@/components/page-shell";
import { ModelRoutesTable, type ModelRouteRow } from "@/components/model-routes-table";
import type { ProviderRow } from "@/components/provider-status-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, type ApiEnvelope } from "@/lib/api";

const schema = z.object({
  alias: z.string().min(1),
  provider: z.string().min(1),
  realModel: z.string().min(1)
});

export default function ModelsPage() {
  const [models, setModels] = useState<ModelRouteRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  function load() {
    Promise.all([
      apiFetch<ApiEnvelope<ModelRouteRow[]>>("/admin/models"),
      apiFetch<ApiEnvelope<ProviderRow[]>>("/admin/providers")
    ])
      .then(([modelResult, providerResult]) => {
        setModels(modelResult.data);
        setProviders(providerResult.data);
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(load, []);

  async function create(values: z.infer<typeof schema>) {
    await apiFetch("/admin/models", {
      method: "POST",
      body: JSON.stringify({ ...values, fallback: [], enabled: true })
    });
    form.reset();
    load();
  }

  const filteredModels = models.filter((model) => {
    const text = `${model.alias} ${model.provider} ${model.realModel}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Models</h1>
          <p className="mt-1 text-sm text-zinc-500">Friendly aliases mapped to provider models and fallback routes.</p>
        </div>
        {error ? <div className="text-sm text-[#ff9aad]">{error}</div> : null}
        <Card>
          <CardHeader><CardTitle>Add model alias</CardTitle></CardHeader>
          <CardContent>
            <form className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={form.handleSubmit(create)}>
              <Input placeholder="Alias" {...form.register("alias")} />
              <select
                className="h-9 rounded-lg border border-white/[0.07] bg-[#101010] px-3 text-sm text-zinc-100 outline-none transition focus:border-white/[0.18]"
                {...form.register("provider")}
              >
                <option value="">Provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.name}>{provider.name}</option>
                ))}
              </select>
              <Input placeholder="Real model" {...form.register("realModel")} />
              <Button><Plus className="h-4 w-4" /> Add</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Manage model routes</CardTitle>
            <Input
              className="sm:w-80"
              placeholder="Search aliases, providers, real models"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </CardHeader>
          <CardContent>
            <ModelRoutesTable data={filteredModels} providers={providers.map((provider) => provider.name)} onChanged={load} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
