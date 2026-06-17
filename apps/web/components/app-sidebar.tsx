"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, KeyRound, MessageSquare, PanelLeftClose, PanelLeftOpen, Route, ServerCog, Settings, X } from "lucide-react";
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
      { href: "/logs", label: "Logs", icon: BarChart3 }
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

export function AppSidebar({
  collapsed,
  onToggleCollapsed,
  mobileNavOpen = false,
  onMobileNavClose
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileNavOpen?: boolean;
  onMobileNavClose?: () => void;
}) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    onMobileNavClose?.();
  }, [pathname, onMobileNavClose]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-20 hidden border-r border-white/[0.05] bg-[#1a1a19] md:block",
          mounted && "transition-[width] duration-200 ease-out",
          collapsed ? "w-[60px]" : "w-56"
        )}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 md:hidden"
          onClick={onMobileNavClose}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[61] w-72 max-w-[85vw] border-r border-white/[0.05] bg-[#1a1a19] transition-transform duration-200 ease-out md:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <span className="text-sm font-medium text-[#ece9e4]">Navigation</span>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#807a6f] transition hover:bg-white/[0.05] hover:text-[#ece9e4]"
            onClick={onMobileNavClose}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <SidebarContent collapsed={false} onToggleCollapsed={onToggleCollapsed} pathname={pathname} forceShowLabels />
      </aside>
    </>
  );
}

function SidebarContent({
  collapsed,
  onToggleCollapsed,
  pathname,
  forceShowLabels = false
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  pathname: string;
  forceShowLabels?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Logo header (desktop only) */}
      {!forceShowLabels && (
        <div className={cn("flex h-14 items-center px-3", collapsed ? "justify-center" : "justify-between")}>
          <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#7aab5e]">
              <span className="text-xs font-bold text-[#1a1a19]">AI</span>
            </div>
            {!collapsed && (
              <span className="text-sm font-medium text-[#ece9e4]">Gateway</span>
            )}
          </div>
          {!collapsed && (
            <button
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#807a6f] transition hover:bg-white/[0.05] hover:text-[#ece9e4]"
              onClick={onToggleCollapsed}
              title="Collapse menu"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
          {collapsed && (
            <button
              className="absolute -right-3 top-4 flex h-6 w-6 items-center justify-center rounded-full border border-white/[0.06] bg-[#232220] text-[#807a6f] transition hover:text-[#ece9e4]"
              onClick={onToggleCollapsed}
              title="Expand menu"
            >
              <PanelLeftOpen className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className={cn("flex-1 space-y-4 overflow-y-auto px-2 py-3")}>
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <div className={cn(
              "px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[#807a6f]",
              collapsed && !forceShowLabels && "opacity-0"
            )}>
              {group.label}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed && !forceShowLabels ? item.label : undefined}
                  className={cn(
                    "flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150",
                    collapsed && !forceShowLabels && "justify-center px-0",
                    active
                      ? "bg-[#7aab5e]/10 text-[#9bc480]"
                      : "text-[#b8b3a8] hover:bg-white/[0.04] hover:text-[#ece9e4]"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active && "text-[#9bc480]")} />
                  <span className={cn(
                    "truncate",
                    collapsed && !forceShowLabels && "hidden"
                  )}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
