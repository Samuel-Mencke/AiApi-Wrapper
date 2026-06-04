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
        variant === "secondary" && "border border-zinc-800 bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
        variant === "ghost" && "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100",
        variant === "danger" && "bg-red-500/15 text-red-200 hover:bg-red-500/25",
        className
      )}
      {...props}
    />
  );
}
