"use client";

import { ShieldCheck } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function Topbar() {
  async function logout() {
    await apiFetch("/admin/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-white/[0.045] bg-[#111111]/96 px-6">
      <div>
        <div className="text-sm font-medium text-zinc-100">Admin Dashboard</div>
        <div className="text-xs text-zinc-500">{API_BASE_URL}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.065] bg-[#18181b] px-3 py-2 text-sm text-zinc-300">
          <ShieldCheck className="h-4 w-4 text-[#8b8d98]" />
          Admin session
        </div>
        <Button variant="ghost" onClick={logout}>Logout</Button>
      </div>
    </header>
  );
}
