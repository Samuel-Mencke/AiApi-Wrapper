"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageShell } from "@/components/page-shell";
import { ModelRoutesTable, type ModelRouteRow } from "@/components/model-routes-table";
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
  const [error, setError] = useState("");
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  function load() {
    apiFetch<ApiEnvelope<ModelRouteRow[]>>("/admin/models")
      .then((result) => setModels(result.data))
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
              <Input placeholder="Provider" {...form.register("provider")} />
              <Input placeholder="Real model" {...form.register("realModel")} />
              <Button><Plus className="h-4 w-4" /> Add</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <ModelRoutesTable data={models} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
