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
        "fixed bottom-0 left-0 top-0 z-20 hidden w-[210px] overflow-y-auto border-r border-hair bg-canvas md:block",
        mounted && "transition-[width] duration-200 ease-out",
        collapsed && "w-[52px]"
      )}>
        <SidebarContent collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} pathname={pathname} />
      </aside>

      {/* Mobile overlay */}
      {mobileNavOpen ? (
        <button type="button" aria-label="Close navigation"
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onMobileNavClose}
        />
      ) : null}

      {/* Mobile drawer */}
      <aside className={cn(
        "fixed bottom-0 left-0 top-0 z-[61] w-72 max-w-[86vw] overflow-y-auto border-r border-hair bg-canvas transition-transform duration-200 md:hidden",
        mobileNavOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-12 items-center justify-between px-4">
          <span className="text-[12px] font-semibold tracking-tight text-ink">Navigation</span>
          <button type="button" className="grid h-7 w-7 place-items-center rounded-lg text-faint transition hover:bg-hover hover:text-ink"
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
  const showLabels = forceShowLabels || !collapsed;

  return (
    <div className="flex h-full flex-col">
      {/* Navigation — starts at top, no brand mark */}
      <nav className="flex-1 overflow-y-auto px-2 pt-3" aria-label="Main navigation">
        {groups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? "mt-4" : ""}>
            <div className={cn(
              "px-2.5 pb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-faint",
              !showLabels && "opacity-0 h-0 pb-0 overflow-hidden"
            )}>
              {group.label}
            </div>
            <div className="space-y-px">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = !item.external && pathname === item.href;
                const classes = cn(
                  "relative flex h-8 items-center gap-2.5 rounded-lg text-[12px] transition-all duration-150",
                  !showLabels && "justify-center px-0",
                  showLabels && "px-2.5",
                  active
                    ? "bg-hover text-ink font-medium"
                    : "text-dim hover:bg-hover hover:text-ink"
                );
                const content = (
                  <>
                    <Icon className={cn("h-[15px] w-[15px] shrink-0", active ? "text-ink" : "")} />
                    {showLabels && <span className="truncate">{item.label}</span>}
                    {item.external && showLabels ? (
                      <ExternalLink className="ml-auto h-3 w-3 text-faint" />
                    ) : null}
                  </>
                );
                return item.external
                  ? <a key={item.href} href={item.href} className={classes} title={!showLabels ? item.label : undefined}>{content}</a>
                  : <Link key={item.href} href={item.href} className={classes} title={!showLabels ? item.label : undefined}>{content}</Link>;
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle at bottom */}
      {!forceShowLabels ? (
        <div className="border-t border-hair p-2">
          <button type="button"
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-lg text-faint transition hover:bg-hover hover:text-ink",
              !showLabels && "justify-center"
            )}
            onClick={onToggleCollapsed} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed
              ? <PanelLeftOpen className="h-[15px] w-[15px] shrink-0" />
              : <><PanelLeftClose className="h-[15px] w-[15px] shrink-0" /><span className="text-[12px]">Collapse</span></>
            }
          </button>
        </div>
      ) : null}
    </div>
  );
}
