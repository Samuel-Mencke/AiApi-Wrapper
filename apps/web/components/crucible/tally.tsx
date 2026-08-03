"use client";

import { motion, type HTMLMotionProps, type Variants } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export interface TallyProps
  extends Omit<HTMLMotionProps<"span">, "children" | "initial" | "whileInView" | "viewport" | "transition"> {
  value: number;
  start?: number;
  decimals?: number;
  locale?: string;
  formatOptions?: Intl.NumberFormatOptions;
  duration?: number;
  stagger?: number;
  delay?: number;
  repeat?: boolean;
}

const DIGIT_ROWS = "0123456789".split("");
const CAST = "#bfdbfe";

function formatValue(value: number, decimals: number, locale: string | undefined, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, ...options }).format(value);
}

export function Tally({
  value, start = 0, decimals = 0, locale = "en-US", formatOptions,
  duration = 1.4, stagger = 0.06, delay = 0, repeat = false, className, ...props
}: TallyProps) {
  const reducedMotion = useReducedMotion();
  const targetStr = React.useMemo(() => formatValue(value, decimals, locale, formatOptions), [value, decimals, locale, formatOptions]);
  const chars = React.useMemo(() => [...targetStr], [targetStr]);
  const totalDigits = React.useMemo(() => (targetStr.match(/[0-9]/g) ?? []).length, [targetStr]);
  const startDigitsFromEnd = React.useMemo(() => {
    const startStr = formatValue(start, decimals, locale, formatOptions);
    return (startStr.match(/[0-9]/g) ?? []).reverse();
  }, [start, decimals, locale, formatOptions]);

  if (reducedMotion) {
    return (
      <motion.span data-crucible="tally" role="img" className={cn("relative isolate inline-flex items-baseline tabular-nums", className)} aria-label={targetStr} {...props}>
        <span aria-hidden style={{ textShadow: "0 0 8px rgba(191,219,254,0.14)" }}>{targetStr}</span>
      </motion.span>
    );
  }

  type DrumCustom = { digit: number; startDigit: number; isLead: boolean };

  const bloomVariants: Variants = {
    hidden: { filter: "drop-shadow(0 0 9px rgba(147,197,253,0.5))" },
    visible: (custom: DrumCustom) => ({
      filter: custom.isLead
        ? ["drop-shadow(0 0 9px rgba(147,197,253,0.5))", "drop-shadow(0 0 20px rgba(191,219,254,0.95))", "drop-shadow(0 0 6px rgba(191,219,254,0.12))"]
        : ["drop-shadow(0 0 9px rgba(147,197,253,0.45))", "drop-shadow(0 0 11px rgba(191,219,254,0.5))", "drop-shadow(0 0 5px rgba(191,219,254,0.1))"],
      transition: { duration, ease: "easeOut", times: custom.isLead ? [0, 0.85, 1] : [0, 0.55, 1] },
    }),
  };

  const drumVariants: Variants = {
    hidden: (custom: DrumCustom) => ({ y: `-${custom.startDigit}em`, color: CAST }),
    visible: (custom: DrumCustom) => ({
      y: `-${custom.digit}em`, color: "#ffffff",
      transition: { y: { type: "spring", duration, bounce: 0.2 }, color: { duration: duration * 0.75, ease: "easeOut" } },
    }),
  };

  const glyphVariants: Variants = {
    hidden: { opacity: 0, y: "0.25em", color: CAST },
    visible: { opacity: 1, y: "0em", color: "#ffffff", transition: { duration: duration * 0.45, ease: "easeOut" } },
  };

  return (
    <motion.span
      data-crucible="tally" role="img"
      className={cn("relative isolate inline-flex items-baseline tabular-nums", className)}
      initial="hidden" whileInView="visible" viewport={{ once: !repeat, amount: 0.6 }}
      transition={{ staggerChildren: stagger, delayChildren: delay }}
      aria-label={targetStr} {...props}
    >
      {(() => {
        let digitsSeen = 0;
        return chars.map((char, i) => {
          const digit = Number(char);
          const isDigit = /[0-9]/.test(char) && !Number.isNaN(digit);
          if (!isDigit) {
            return <motion.span key={i} aria-hidden variants={glyphVariants} className="inline-block">{char}</motion.span>;
          }
          const distanceFromEnd = totalDigits - digitsSeen - 1;
          const isLead = digitsSeen === 0;
          digitsSeen += 1;
          const startDigit = Number(startDigitsFromEnd[distanceFromEnd] ?? "0");
          const custom: DrumCustom = { digit, startDigit, isLead };
          return (
            <motion.span key={i} aria-hidden custom={custom} variants={bloomVariants} className="inline-block align-baseline will-change-[filter]">
              <span className="relative inline-block align-baseline" style={{ lineHeight: "1em", clipPath: "inset(0)", overflow: "hidden" }}>
                <span className="invisible">{char}</span>
                <motion.span custom={custom} variants={drumVariants} className="absolute inset-x-0 top-0 flex flex-col items-center will-change-transform">
                  {DIGIT_ROWS.map((d) => <span key={d} className="block text-center" style={{ height: "1em", lineHeight: "1em" }}>{d}</span>)}
                </motion.span>
              </span>
            </motion.span>
          );
        });
      })()}
    </motion.span>
  );
}
