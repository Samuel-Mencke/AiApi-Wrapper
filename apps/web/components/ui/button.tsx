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
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-45",
        variant === "default" && "bg-[#e7e7ea] text-[#101010] hover:bg-white",
        variant === "secondary" && "border border-white/[0.075] bg-[#242428] text-zinc-100 hover:bg-[#2d2d32]",
        variant === "ghost" && "text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100",
        variant === "danger" && "bg-[#ff5c7a]/15 text-[#ff9aad] hover:bg-[#ff5c7a]/25",
        className
      )}
      {...props}
    />
  );
}
