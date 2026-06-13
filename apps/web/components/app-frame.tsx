"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";
import { cn } from "@/lib/utils";

export function AppFrame({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("ai-gateway-sidebar-collapsed") === "true";
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      window.localStorage.setItem("ai-gateway-sidebar-collapsed", String(!current));
      return !current;
    });
  }

  return (
    <div className="min-h-screen bg-[#111111] text-zinc-100">
      <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div className={cn(mounted && "transition-[padding] duration-300 ease-out", "md:pl-56 xl:pl-64", collapsed && "md:pl-20 xl:pl-20")}>
        <Topbar />
        <main className={cn(flush ? "p-0" : "p-4 md:p-6")}>{children}</main>
      </div>
    </div>
  );
}
