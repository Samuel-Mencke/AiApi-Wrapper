import * as React from "react";
import { cn } from "@/lib/utils";

export function Button({ className, variant = "default", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost" | "danger";
}) {
  return <button className={cn(
    "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
    variant === "default" && "bg-accent text-[#0a0a0a] hover:bg-accent-hover",
    variant === "secondary" && "border border-line bg-elevated text-dim hover:bg-hover hover:text-ink hover:border-strong",
    variant === "ghost" && "text-faint hover:bg-hover hover:text-dim",
    variant === "danger" && "bg-danger/12 text-[var(--danger)] hover:bg-danger/20",
    className
  )} {...props} />;
}
