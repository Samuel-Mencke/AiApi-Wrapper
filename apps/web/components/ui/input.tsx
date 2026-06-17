import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-white/[0.08] bg-[#1f1e1c] px-3 text-sm text-[#ece9e4] outline-none transition-all duration-200 placeholder:text-[#5a554d] hover:border-white/[0.12] focus:border-[#7aab5e]/40 focus:ring-2 focus:ring-[#7aab5e]/10",
        className
      )}
      suppressHydrationWarning
      {...props}
    />
  );
}
