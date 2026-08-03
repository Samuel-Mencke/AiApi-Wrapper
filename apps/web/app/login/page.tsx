"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BrainCircuit, Lock } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ authenticated: boolean }>("admin/session")
      .then((session) => { if (session.authenticated) router.replace("/dashboard"); })
      .catch(() => undefined);
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiFetch("/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas">
      {/* Background layers */}
      <div className="ambient-glow" />
      <div className="ambient-glow-bottom" />
      <div className="dot-grid absolute inset-0 opacity-50" />

      <div className="relative z-10 w-full max-w-[400px] px-4">
        {/* Brand */}
        <div className="mb-10 flex flex-col items-center text-center animate-fade-in">
          <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-accent-border bg-accent-muted glow-accent">
            <BrainCircuit className="h-7 w-7 text-accent"/>
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-ink">Model Console</h1>
          <p className="mt-2 text-sm text-faint">Self-hosted AI gateway · Unified routing & analytics</p>
        </div>

        {/* Card */}
        <div className="glass-card animate-fade-in-scale rounded-2xl p-7 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_20px_60px_rgba(0,0,0,0.5)]" style={{animationDelay:"100ms"}}>
          <form className="space-y-5" onSubmit={submit}>
            <div className="space-y-2">
              <label htmlFor="username" className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                <span className="h-1 w-1 rounded-full bg-accent"/> Username
              </label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus className="h-11" />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">
                <Lock className="h-3 w-3"/> Password
              </label>
              <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" className="h-11" />
            </div>
            {error ? (
              <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2.5 text-xs text-[var(--danger)] animate-fade-in">{error}</div>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-accent text-[13px] font-semibold text-[#060708] transition-all duration-200 hover:shadow-[0_0_24px_var(--accent-muted)] disabled:opacity-40"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"/>
              {loading ? "Signing in..." : "Continue"}
              {!loading && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5"/>}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-faint animate-fade-in" style={{animationDelay:"300ms"}}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="status-ping absolute inline-flex h-full w-full rounded-full bg-success"/>
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success"/>
          </span>
          <span>API operational</span>
        </div>
      </div>
    </div>
  );
}
