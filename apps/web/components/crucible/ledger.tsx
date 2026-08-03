"use client";

import { motion, useInView } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Scriber, type ScriberProps } from "@/components/crucible/scriber";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { Tally } from "@/components/crucible/tally";

export type LedgerFormat = "number" | "currency" | "percent";
export type LedgerDirection = "up" | "down" | "flat";
export type LedgerTrigger = "in-view" | "mount" | "prop-change";
export type LedgerSize = "sm" | "md" | "lg";

export interface LedgerProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  label: string;
  value: number;
  format?: LedgerFormat;
  currency?: string;
  locale?: string;
  decimals?: number;
  delta?: number;
  deltaDirection?: LedgerDirection;
  deltaDecimals?: number;
  sparkline?: number[];
  sparklineProps?: Omit<ScriberProps, "data">;
  trigger?: LedgerTrigger;
  delay?: number;
  stagger?: number;
  valueDuration?: number;
  sparklineDuration?: number;
  badgeDuration?: number;
  size?: LedgerSize;
  colors?: { up?: string; down?: string; flat?: string };
  paused?: boolean;
}

const SIZES = {
  sm: { card: "p-4", label: "text-[10px]", value: "text-2xl", valueMt: "mt-2", badge: "text-[10px]", spark: "h-8", sparkMt: "mt-3 pt-3" },
  md: { card: "p-5", label: "text-[11px]", value: "text-[28px]", valueMt: "mt-3", badge: "text-[11px]", spark: "h-10", sparkMt: "mt-4 pt-4" },
  lg: { card: "p-6", label: "text-xs", value: "text-5xl", valueMt: "mt-4", badge: "text-xs", spark: "h-12", sparkMt: "mt-5 pt-5" },
} as const;

const DEFAULT_COLORS = { up: "#45b881", down: "#e5484d", flat: "#666666" };
const ARROWS: Record<LedgerDirection, string> = { up: "↑", down: "↓", flat: "–" };

export function Ledger({
  label, value, format = "number", currency = "USD", locale = "en-US", decimals,
  delta, deltaDirection, deltaDecimals = 1, sparkline, sparklineProps,
  trigger = "in-view", delay = 0, stagger = 0.75, valueDuration = 1.4,
  sparklineDuration = 1.2, badgeDuration = 0.5, size = "md", colors, paused = false, className, ...props
}: LedgerProps) {
  const reducedMotion = useReducedMotion();
  const staticMode = reducedMotion || paused;
  const S = SIZES[size];

  const dec = decimals ?? (format === "currency" ? 2 : format === "percent" ? 1 : 0);
  const formatOptions = React.useMemo<Intl.NumberFormatOptions | undefined>(() => {
    if (format === "currency") return { style: "currency", currency };
    if (format === "percent") return { style: "percent" };
    return undefined;
  }, [format, currency]);

  const formatted = React.useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec, ...formatOptions }).format(value),
    [value, dec, locale, formatOptions]
  );

  const direction: LedgerDirection = deltaDirection ?? (delta == null || delta === 0 ? "flat" : delta > 0 ? "up" : "down");
  const dirColor = (colors?.[direction] ?? DEFAULT_COLORS[direction])!;
  const deltaText = React.useMemo(() => {
    if (delta == null) return "";
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: deltaDecimals }).format(Math.abs(delta))}%`;
  }, [delta, locale, deltaDecimals]);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.35 });
  const [started, setStarted] = React.useState(false);
  const [sparkGo, setSparkGo] = React.useState(false);
  const initialValueRef = React.useRef(value);

  React.useEffect(() => {
    if (started) return;
    if (trigger === "prop-change") { if (value !== initialValueRef.current) setStarted(true); }
    else if (trigger === "mount" || inView) setStarted(true);
  }, [started, trigger, inView, value]);

  React.useEffect(() => {
    if (!started || sparkGo) return;
    if (staticMode) { setSparkGo(true); return; }
    const t = window.setTimeout(() => setSparkGo(true), Math.max(0, (delay + stagger) * 1000));
    return () => window.clearTimeout(t);
  }, [started, sparkGo, staticMode, delay, stagger]);

  const hasSparkline = !!sparkline && sparkline.length >= 2;
  const badgeDelay = delay + stagger * (hasSparkline ? 2 : 1);

  const holdStatic = paused || (trigger === "prop-change" && !started);
  const valueNode = holdStatic ? (
    <span aria-hidden className="tabular-nums">{formatted}</span>
  ) : (
    <Tally aria-hidden value={value} start={trigger === "prop-change" ? initialValueRef.current : 0} decimals={dec} locale={locale} formatOptions={formatOptions} duration={valueDuration} delay={delay} />
  );

  const badgeCls = cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] font-medium leading-none tabular-nums", S.badge);
  const badgeStyle: React.CSSProperties = { color: dirColor, borderColor: `color-mix(in srgb, ${dirColor} 30%, transparent)`, backgroundColor: `color-mix(in srgb, ${dirColor} 9%, transparent)` };
  const badgeInner = (<><span className="text-[0.85em]">{ARROWS[direction]}</span><span>{deltaText}</span></>);
  const badge = delta == null ? null : staticMode ? (
    <span aria-hidden className={badgeCls} style={badgeStyle}>{badgeInner}</span>
  ) : (
    <motion.span aria-hidden key={`${direction}:${deltaText}`} className={cn(badgeCls, "will-change-[transform,opacity]")} style={{ ...badgeStyle, transformPerspective: 420 }}
      initial={{ opacity: 0, rotateX: 92 }} animate={started ? { opacity: [0, 1, 1], rotateX: [92, -7, 0] } : undefined}
      transition={{ delay: badgeDelay, duration: badgeDuration, times: [0, 0.8, 1], ease: "easeOut" }}>
      {badgeInner}
    </motion.span>
  );

  return (
    <div ref={rootRef} data-crucible="ledger" className={cn("relative flex flex-col rounded-xl border border-hair bg-panel text-left", S.card, className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <span className={cn("font-medium uppercase tracking-[0.14em] text-faint", S.label)}>{label}</span>
        {badge}
      </div>
      <div className={cn("font-semibold leading-none tracking-[-0.03em] text-ink", S.valueMt, S.value)}>{valueNode}</div>
      {hasSparkline ? (
        <span aria-hidden className={cn("block border-t border-hair", S.sparkMt)}>
          <Scriber variant="area" data={sparkline} {...sparklineProps} drawDuration={paused ? 0 : sparklineDuration} paused={paused || !sparkGo} className={cn("block w-full", S.spark)} />
        </span>
      ) : null}
    </div>
  );
}
