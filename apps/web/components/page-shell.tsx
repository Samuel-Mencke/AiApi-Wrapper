import type { ReactNode } from "react";
import { AppFrame } from "@/components/app-frame";

export function PageShell({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
