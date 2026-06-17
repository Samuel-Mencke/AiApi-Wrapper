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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileNavOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      window.localStorage.setItem("ai-gateway-sidebar-collapsed", String(!current));
      return !current;
    });
  }

  return (
    <div className="min-h-screen bg-[#1a1a19] text-[#ece9e4]">
      {/* Mobile overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileNavOpen={mobileNavOpen}
        onMobileNavClose={() => setMobileNavOpen(false)}
      />
      <div className={cn(mounted && "transition-[padding] duration-200 ease-out", "md:pl-56", collapsed && "md:pl-[60px]")}>
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className={cn(flush ? "p-0" : "p-4 md:p-6")}>{children}</main>
      </div>
    </div>
  );
}
