import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(
    "h-10 w-full rounded-lg border border-line bg-input px-3 text-sm text-ink outline-none transition-colors placeholder:text-faint hover:border-strong focus:border-accent",
    className
  )} suppressHydrationWarning {...props} />;
}
