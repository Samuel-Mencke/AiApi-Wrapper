import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  detail,
  sparkline
}: {
  label: string;
  value: string;
  detail?: string;
  accentColor?: string;
  sparkline?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-faint">{label}</div>
        <div className="mt-2 text-2xl font-bold tracking-tight text-ink">{value}</div>
        {detail ? <div className="mt-1 text-xs text-faint">{detail}</div> : null}
        {sparkline ? <div className="mt-3">{sparkline}</div> : null}
      </CardContent>
    </Card>
  );
}
