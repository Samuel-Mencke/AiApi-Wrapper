"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, Database, FileText, KeyRound, MessageSquare, PanelLeftClose, PanelLeftOpen, Route, ServerCog, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const groups = [
  {
    label: "Main",
    items: [
      { href: "/chat", label: "Chat", icon: MessageSquare },
      { href: "/dashboard", label: "Dashboard", icon: BarChart3 }
    ]
  },
  {
    label: "Gateway",
    items: [
      { href: "/providers", label: "Providers", icon: ServerCog },
      { href: "/models", label: "Models", icon: Route },
      { href: "/api-keys", label: "API Keys", icon: KeyRound },
      { href: "/logs", label: "Logs", icon: FileText }
    ]
  },
  {
    label: "System",
    items: [
      { href: "/docs", label: "Docs", icon: BookOpen },
      { href: "/settings", label: "Settings", icon: Settings }
    ]
  }
];

export function AppSidebar({ collapsed, onToggleCollapsed }: { collapsed: boolean; onToggleCollapsed: () => void }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-20 hidden border-r border-white/[0.045] bg-[#0d0d0e] md:block",
        mounted && "transition-[width] duration-300 ease-out",
        collapsed ? "w-20" : "w-56 xl:w-64"
      )}
    >
      <div className={cn("flex h-16 items-center border-b border-white/[0.045] px-4", collapsed ? "justify-center" : "justify-between gap-3")}>
        <div className={cn("flex min-w-0 items-center gap-3", collapsed && "justify-center")}>
          <Database className="h-5 w-5 shrink-0 text-zinc-100" />
          <div className={cn("min-w-0 transition-opacity duration-200", collapsed && "pointer-events-none hidden opacity-0")}>
            <div className="truncate text-sm font-semibold text-zinc-100">ai-gateway</div>
            <div className="truncate text-xs text-zinc-500">API control plane</div>
          </div>
        </div>
        <button
          className={cn(
            "hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-100 md:inline-flex",
            collapsed && "absolute -right-4 top-5 bg-[#111111]"
          )}
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand menu" : "Collapse menu"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>
      <nav className={cn("space-y-5 p-3", collapsed && "px-2")}>
        {groups.map((group) => (
          <div key={group.label} className="space-y-1">
            <div className={cn("px-3 text-[11px] font-medium uppercase tracking-wide text-zinc-600 transition-opacity", collapsed && "h-2 overflow-hidden px-0 text-transparent opacity-0")}>
              {group.label}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-zinc-100",
                    collapsed && "justify-center px-0",
                    active && "bg-[#242428] text-zinc-100"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className={cn("truncate transition-opacity duration-200", collapsed && "hidden opacity-0")}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
