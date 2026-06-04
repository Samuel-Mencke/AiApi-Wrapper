import { ShieldCheck } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";

export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-6">
      <div>
        <div className="text-sm font-medium text-zinc-100">Admin Dashboard</div>
        <div className="text-xs text-zinc-500">{API_BASE_URL}</div>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
        <ShieldCheck className="h-4 w-4 text-blue-300" />
        Personal mode
      </div>
    </header>
  );
}
