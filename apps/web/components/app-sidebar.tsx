"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AudioLines, BarChart3, BookOpen, ExternalLink, KeyRound,
  MessageSquare, PanelLeftClose, PanelLeftOpen, Route, ServerCog,
  Settings, X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; external?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const chatUrl = process.env.NEXT_PUBLIC_CHAT_URL?.trim();

const groups: NavGroup[] = [
  { label: "Workspace", items: [
    { href: "/dashboard", label: "Overview", icon: BarChart3 },
    ...(chatUrl ? [{ href: chatUrl, label: "Chat", icon: MessageSquare, external: true }] : []),
    { href: "/transcription", label: "Transcription", icon: AudioLines }
  ]},
  { label: "Routing", items: [
    { href: "/providers", label: "Providers", icon: ServerCog },
    { href: "/models",    label: "Models",    icon: Route },
    { href: "/api-keys",  label: "API Keys",  icon: KeyRound },
    { href: "/logs",      label: "Logs",      icon: BarChart3 }
  ]},
  { label: "System", items: [
    { href: "/docs",     label: "Docs",     icon: BookOpen },
    { href: "/settings", label: "Settings", icon: Settings }
  ]}
];

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileNavOpen?: boolean;
  onMobileNavClose?: () => void;
};

export function AppSidebar({ collapsed, onToggleCollapsed, mobileNavOpen = false, onMobileNavClose }: SidebarProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { onMobileNavClose?.(); }, [pathname, onMobileNavClose]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={cn(
        "fixed bottom-0 left-0 top-0 z-20 hidden w-[220px] overflow-y-auto border-r border-hair bg-panel md:block",
        mounted && "transition-[width] duration-200 ease-out",
        collapsed && "w-[56px]"
      )}>
        <SidebarContent collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} pathname={pathname} />
      </aside>

      {/* Mobile overlay */}
      {mobileNavOpen ? (
        <button type="button" aria-label="Close navigation"
          className="fixed inset-0 z-[60] bg-black/50 md:hidden"
          onClick={onMobileNavClose}
        />
      ) : null}

      {/* Mobile drawer */}
      <aside className={cn(
        "fixed bottom-0 left-0 top-0 z-[61] w-72 max-w-[86vw] overflow-y-auto border-r border-hair bg-panel transition-transform duration-200 md:hidden",
        mobileNavOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-14 items-center justify-between px-4">
          <span className="text-[13px] font-semibold tracking-tight text-ink">Navigation</span>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-lg text-faint transition hover:bg-hover hover:text-ink"
            onClick={onMobileNavClose} aria-label="Close navigation">
            <X className="h-4 w-4" />
          </button>
        </div>
        <SidebarContent collapsed={false} onToggleCollapsed={onToggleCollapsed} pathname={pathname} forceShowLabels />
      </aside>
    </>
  );
}

function SidebarContent({ collapsed, onToggleCollapsed, pathname, forceShowLabels = false }: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  pathname: string;
  forceShowLabels?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {!forceShowLabels ? (
        <div className={cn("flex h-12 items-center px-2", collapsed ? "justify-center" : "justify-end")}>
          <button type="button" className="grid h-8 w-8 place-items-center text-faint transition hover:bg-hover hover:text-ink"
            onClick={onToggleCollapsed} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      ) : null}

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main navigation">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <div className={cn(
              "px-3 py-1 text-[9px] font-medium uppercase tracking-[0.12em] text-faint",
              collapsed && !forceShowLabels && "opacity-0"
            )}>
              {group.label}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = !item.external && pathname === item.href;
              const classes = cn(
                "flex h-9 items-center gap-3 px-3 text-[13px] transition-colors",
                collapsed && !forceShowLabels && "justify-center px-0",
                active
                  ? "bg-white/[0.05] text-ink font-medium"
                  : "text-dim hover:bg-hover hover:text-ink"
              );
              const content = (
                <>
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-accent" />
                  )}
                  <Icon className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "group-hover:text-dim")} />
                  <span className={cn("truncate", collapsed && !forceShowLabels && "hidden")}>{item.label}</span>
                  {item.external && !(collapsed && !forceShowLabels) ? (
                    <ExternalLink className="ml-auto h-3 w-3 text-faint" />
                  ) : null}
                </>
              );
              return item.external
                ? <a key={item.href} href={item.href} className={classes} title={collapsed && !forceShowLabels ? item.label : undefined}>{content}</a>
                : <Link key={item.href} href={item.href} className={cn("relative", classes)} title={collapsed && !forceShowLabels ? item.label : undefined}>{content}</Link>;
            })}
          </div>
        ))}
      </nav>


    </div>
  );
}
