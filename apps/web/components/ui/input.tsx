import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-white/[0.065] bg-[#151515] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/[0.16]",
        className
      )}
      suppressHydrationWarning
      {...props}
    />
  );
}
