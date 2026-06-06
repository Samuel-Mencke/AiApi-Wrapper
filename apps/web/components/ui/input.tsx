import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-xl border border-white/[0.06] bg-[#111111] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600",
        className
      )}
      {...props}
    />
  );
}
