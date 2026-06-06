"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { LockKeyhole, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.06] bg-[#1f1f22]">
            <LockKeyhole className="h-5 w-5 text-zinc-300" />
          </div>
          <CardTitle>Admin login</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" />
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
            />
            {error ? <div className="text-sm text-[#ff9aad]">{error}</div> : null}
            <Button className="w-full" disabled={loading}>
              <LogIn className="h-4 w-4" />
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
