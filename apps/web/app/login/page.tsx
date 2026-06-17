"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("samuel");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ authenticated: boolean }>("/admin/session")
      .then((session) => {
        if (session.authenticated) router.replace("/dashboard");
      })
      .catch(() => undefined);
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiFetch("/admin/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#1a1a19] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#7aab5e]">
            <span className="text-sm font-bold text-[#1a1a19]">AI</span>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-[#ece9e4]">AI Gateway</h1>
          <p className="mt-1 text-sm text-[#807a6f]">Self-hosted AI routing & analytics</p>
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-[#232220] p-6">
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#807a6f]">Username</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#807a6f]">Password</label>
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type="password"
                autoComplete="current-password"
              />
            </div>
            {error ? (
              <div className="rounded-lg border border-[#d65d5d]/20 bg-[#d65d5d]/8 px-3 py-2 text-sm text-[#e08585]">{error}</div>
            ) : null}
            <Button className="w-full !h-10 font-medium" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-[#5a554d]">Powered by AiApi-Wrapper</p>
      </div>
    </main>
  );
}
