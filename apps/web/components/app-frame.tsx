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
    return window.localStorage.getItem("model-console-sidebar-collapsed") === "true";
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuOpenTimeRef = useRef(0);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileNavOpen]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      window.localStorage.setItem("model-console-sidebar-collapsed", String(!current));
      return !current;
    });
  }

  const handleOpenMenu = useCallback(() => {
    menuOpenTimeRef.current = Date.now();
    setMobileNavOpen(true);
  }, []);

  const handleCloseMenu = useCallback(() => {
    if (Date.now() - menuOpenTimeRef.current > 150) setMobileNavOpen(false);
  }, []);

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} mobileNavOpen={mobileNavOpen} onMobileNavClose={handleCloseMenu} />
      <div className={cn(
        "min-h-screen bg-canvas",
        mounted && "transition-[margin] duration-200 ease-out",
        "md:ml-[220px]",
        collapsed && "md:ml-[56px]"
      )}>
        <Topbar onMenuClick={handleOpenMenu} />
        <main className={cn(flush ? "p-0" : "p-4 md:p-6 lg:p-7")}>{children}</main>
      </div>
    </div>
  );
}
