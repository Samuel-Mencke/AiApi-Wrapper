"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const menuOpenTimeRef = useRef(0);

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

  const handleOpenMenu = useCallback(() => {
    menuOpenTimeRef.current = Date.now();
    setMobileNavOpen(true);
  }, []);

  const handleCloseMenu = useCallback(() => {
    // Ignore clicks that arrive within 150ms of opening (touch propagation guard)
    if (Date.now() - menuOpenTimeRef.current > 150) {
      setMobileNavOpen(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#1a1a19] text-[#ece9e4]">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileNavOpen={mobileNavOpen}
        onMobileNavClose={handleCloseMenu}
      />
      <div className={cn(mounted && "transition-[padding] duration-200 ease-out", "md:pl-56", collapsed && "md:pl-[60px]")}>
        <Topbar onMenuClick={handleOpenMenu} />
        <main className={cn(flush ? "p-0" : "p-4 md:p-6")}>{children}</main>
      </div>
    </div>
  );
}
