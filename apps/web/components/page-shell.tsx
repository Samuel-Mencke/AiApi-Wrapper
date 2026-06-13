import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";

export function PageShell({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return <AppFrame flush={flush}>{children}</AppFrame>;
}
