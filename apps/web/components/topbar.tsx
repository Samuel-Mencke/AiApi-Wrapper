"use client";

import { LogOut, Menu } from "lucide-react";
import { PUBLIC_API_URL, apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  async function logout() {
    await apiFetch("/admin/logout", { method: "POST" }).catch(() => undefined);
    window.location.href = "/login";
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-hair bg-canvas px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-faint transition hover:bg-hover hover:text-ink md:hidden"
          onClick={onMenuClick} aria-label="Open navigation">
          <Menu className="h-[18px] w-[18px]" />
        </button>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-tight text-ink">Model Console</div>
          <div className="hidden items-center gap-1.5 truncate text-[10px] text-faint sm:flex">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
            {PUBLIC_API_URL.replace(/^https?:\/\//, "")}
          </div>
        </div>
      </div>
      <Button variant="ghost" className="h-8 rounded-lg px-2.5 text-[11px]" onClick={logout}>
        <LogOut className="h-3.5 w-3.5" />Logout
      </Button>
    </header>
  );
}
