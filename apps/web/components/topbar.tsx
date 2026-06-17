"use client";

import { Menu } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  async function logout() {
    await apiFetch("/admin/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/[0.05] bg-[#1a1a19]/80 px-4 backdrop-blur-sm md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#807a6f] transition hover:bg-white/[0.04] hover:text-[#ece9e4] md:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[#ece9e4]">Admin Dashboard</div>
          <div className="truncate text-[11px] text-[#807a6f] hidden sm:block">
            {API_BASE_URL.replace(/^https?:\/\//, "")}
          </div>
        </div>
      </div>

      <Button variant="ghost" className="h-8 px-3 text-xs" onClick={logout}>Logout</Button>
    </header>
  );
}
