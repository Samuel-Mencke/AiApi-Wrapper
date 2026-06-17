import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  detail,
  accentColor = "#7aab5e",
  sparkline
}: {
  label: string;
  value: string;
  detail?: string;
  accentColor?: string;
  sparkline?: ReactNode;
}) {
  return (
    <Card className="lift-on-hover group overflow-hidden bg-[#232220]" >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium uppercase tracking-wide text-[#807a6f]">{label}</div>
            <div className="mt-2 truncate text-2xl font-bold tracking-tight text-[#ece9e4]">{value}</div>
            {detail ? <div className="mt-1 truncate text-xs text-[#807a6f]">{detail}</div> : null}
          </div>
          <span
            className="mt-1 h-2 w-2 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
            style={{ background: accentColor, color: accentColor }}
          />
        </div>
        {sparkline ? <div className="mt-3">{sparkline}</div> : null}
      </CardContent>
    </Card>
  );
}
