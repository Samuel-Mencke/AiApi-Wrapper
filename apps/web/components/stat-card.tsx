import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  detail,
  accentColor = "#3ddc97",
  sparkline
}: {
  label: string;
  value: string;
  detail?: string;
  accentColor?: string;
  sparkline?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden bg-[#131313]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-zinc-500">{label}</div>
            <div className="mt-2 truncate text-2xl font-semibold text-zinc-100">{value}</div>
            {detail ? <div className="mt-1 truncate text-xs text-zinc-500">{detail}</div> : null}
          </div>
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accentColor }} />
        </div>
        {sparkline ? <div className="mt-3">{sparkline}</div> : null}
      </CardContent>
    </Card>
  );
}
