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
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
        variant === "default" && "bg-[#7aab5e] text-[#1a1a19] hover:bg-[#8fc068]",
        variant === "secondary" && "border border-white/[0.07] bg-white/[0.03] text-[#b8b3a8] hover:bg-white/[0.06]",
        variant === "ghost" && "text-[#807a6f] hover:bg-white/[0.04] hover:text-[#ece9e4]",
        variant === "danger" && "bg-[#d65d5d]/12 text-[#e08585] hover:bg-[#d65d5d]/20",
        className
      )}
      {...props}
    />
  );
}
