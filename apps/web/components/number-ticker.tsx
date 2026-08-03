"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface NumberTickerProps {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function NumberTicker({ value, duration = 800, className, format }: NumberTickerProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValue = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = previousValue.current;
    const diff = value - start;
    if (diff === 0) return;

    const startTime = performance.now();
    let cancelled = false;

    function tick(now: number) {
      if (cancelled) return;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      setDisplayValue(Math.round(start + diff * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        previousValue.current = value;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      previousValue.current = value;
    };
  }, [value, duration]);

  const formatted = format ? format(displayValue) : new Intl.NumberFormat().format(displayValue);
  return <span className={cn("tabular-nums", className)}>{formatted}</span>;
}
