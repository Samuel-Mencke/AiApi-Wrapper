"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Model Console</h1>
        <p className="mt-1 text-sm text-faint">Sign in to continue.</p>

        <form className="mt-8 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <label htmlFor="username" className="block text-xs font-medium text-dim">Username</label>
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="block text-xs font-medium text-dim">Password</label>
            <Input id="password" value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
          </div>
          {error ? (
            <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2.5 text-xs text-[var(--danger)]">{error}</div>
          ) : null}
          <Button type="submit" className="mt-2 h-11 w-full text-[13px]" disabled={loading}>
            {loading ? "Signing in..." : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
