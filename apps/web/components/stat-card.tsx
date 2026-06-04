import { Card, CardContent } from "@/components/ui/card";

export function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card>
      <CardContent>
        <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-zinc-100">{value}</div>
        {detail ? <div className="mt-1 text-xs text-zinc-500">{detail}</div> : null}
      </CardContent>
    </Card>
  );
}
