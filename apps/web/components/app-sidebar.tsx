"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, Database, FileText, KeyRound, Route, ServerCog, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/providers", label: "Providers", icon: ServerCog },
  { href: "/models", label: "Models", icon: Route },
  { href: "/api-keys", label: "API Keys", icon: KeyRound },
  { href: "/logs", label: "Logs", icon: FileText },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 w-64 border-r border-zinc-800 bg-zinc-950">
      <div className="flex h-16 items-center gap-3 border-b border-zinc-800 px-5">
        <Database className="h-5 w-5 text-zinc-100" />
        <div>
          <div className="text-sm font-semibold text-zinc-100">ai-gateway</div>
          <div className="text-xs text-zinc-500">API control plane</div>
        </div>
      </div>
      <nav className="space-y-1 p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
                active && "bg-zinc-900 text-zinc-100"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
