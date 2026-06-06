"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "bg-zinc-100 text-zinc-950 hover:bg-white",
        variant === "secondary" && "border border-white/[0.06] bg-[#1f1f22] text-zinc-100 hover:bg-white/[0.04]",
        variant === "ghost" && "text-zinc-300 hover:bg-white/[0.04] hover:text-zinc-100",
        variant === "danger" && "bg-[#ff5c7a]/15 text-[#ff9aad] hover:bg-[#ff5c7a]/25",
        className
      )}
      {...props}
    />
  );
}
