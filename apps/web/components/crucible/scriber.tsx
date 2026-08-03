"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useVisibilityPause } from "@/hooks/use-visibility-pause";

export type ScriberVariant = "line" | "area" | "bars";
export type ScriberEasing = "linear" | "easeIn" | "easeOut" | "easeInOut" | ((t: number) => number);

export interface ScriberColors {
  stroke?: string;
  fill?: string;
  tip?: string;
  dot?: string;
  track?: string;
}

export interface ScriberProps extends Omit<React.ComponentPropsWithoutRef<"span">, "children"> {
  data?: number[];
  variant?: ScriberVariant;
  strokeWidth?: number;
  fillDirection?: "down" | "up";
  fillOpacity?: number;
  drawDuration?: number;
  drawEasing?: ScriberEasing;
  bounds?: [min: number, max: number];
  seed?: number;
  colors?: ScriberColors;
  paused?: boolean;
  label?: string;
}

const HOT = 0.085;
const EASINGS: Record<string, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function round2(n: number) { return Math.round(n * 100) / 100; }
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 429497296; }; }
function demoSeries(seed: number, n: number) { const rnd = mulberry32(seed); const out: number[] = []; let v = 0.32; for (let i = 0; i < n; i++) { v = clamp(v + (rnd() - 0.44) * 0.16, 0.06, 0.97); out.push(round2(v)); } return out; }

export function Scriber({
  data, variant = "line", strokeWidth = 1.5, fillDirection = "down", fillOpacity = 0.22,
  drawDuration = 1.2, drawEasing = "easeOut", bounds, seed = 11, colors, paused = false, label, className, ...props
}: ScriberProps) {
  const reducedMotion = useReducedMotion();
  const rawId = React.useId().replace(/[^a-zA-Z0-9-]/g, "");
  const gradId = `scriber-grad-${rawId}`;
  const clipId = `scriber-clip-${rawId}`;

  const stroke = colors?.stroke ?? "#e2e8f0";
  const fillColor = colors?.fill ?? stroke;
  const tipColor = colors?.tip ?? "#ffffff";
  const dotColor = colors?.dot ?? "#f8fafc";
  const trackColor = colors?.track ?? "rgba(148,163,184,0.16)";
  const dotR = Math.max(2, strokeWidth * 1.3);

  const points = React.useMemo(() => {
    const src = data && data.length >= 2 ? data : demoSeries(seed, 24);
    return src.length >= 2 ? src : [src[0] ?? 0.5, src[0] ?? 0.5];
  }, [data, seed]);

  const [size, setSize] = React.useState({ w: 120, h: 32 });
  const geo = React.useMemo(() => {
    const { w, h } = size;
    const pad = Math.ceil(dotR + strokeWidth / 2 + 1);
    const innerW = Math.max(1, w - pad * 2);
    const innerH = Math.max(1, h - pad * 2);
    const step = innerW / Math.max(1, points.length - 1);
    let lo: number; let hi: number;
    if (bounds) { [lo, hi] = bounds; } else { lo = Math.min(...points); hi = Math.max(...points); }
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
    const xs = points.map((_, i) => round2(pad + i * step));
    const ys = points.map((v) => round2(pad + (1 - clamp((v - lo) / (hi - lo), 0, 1)) * innerH));
    const dLine = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x} ${ys[i]}`).join(" ");
    const baseY = round2(h - pad);
    const dArea = `${dLine} L${xs[xs.length - 1]} ${baseY} L${xs[0]} ${baseY} Z`;
    const barW = round2(Math.max(1.25, step * 0.55));
    const bars = points.map((_, i) => {
      const y = ys[i] ?? baseY;
      const x = xs[i] ?? pad;
      const bh = round2(Math.max(0.75, baseY - y));
      return { x: round2(x - barW / 2), y: round2(baseY - bh), w: barW, h: bh };
    });
    return { pad, step, xs, ys, dLine, dArea, baseY, bars };
  }, [points, size, bounds, strokeWidth, dotR]);

  const [drawn, setDrawn] = React.useState(false);
  const isDrawn = drawn || reducedMotion || drawDuration <= 0;
  const mainPathRef = React.useRef<SVGPathElement>(null);
  const hotPathRef = React.useRef<SVGPathElement>(null);
  const clipRectRef = React.useRef<SVGRectElement>(null);
  const tipDotRef = React.useRef<SVGCircleElement>(null);
  const dotRef = React.useRef<SVGCircleElement>(null);
  const dotHaloRef = React.useRef<SVGCircleElement>(null);
  const barRefs = React.useRef<(SVGRectElement | null)[]>([]);
  const drawDoneRef = React.useRef(false);
  const lenCacheRef = React.useRef({ d: "", len: 0 });
  const ease = React.useMemo<(t: number) => number>(
    () => typeof drawEasing === "function" ? drawEasing : (EASINGS[drawEasing] ?? ((t) => t)),
    [drawEasing]
  );

  const tick = React.useCallback((elapsed: number) => {
    if (drawDoneRef.current) return;
    const raw = drawDuration > 0 ? Math.min(1, elapsed / drawDuration) : 1;
    const p = ease(clamp(raw, 0, 1));
    if (variant === "bars") {
      const n = geo.bars.length;
      geo.bars.forEach((b, i) => {
        const rect = barRefs.current[i];
        if (!rect) return;
        const bp = clamp((p * (n + 2.4) - i) / 2.4, 0, 1);
        rect.setAttribute("y", String(b.y + b.h * (1 - bp)));
        rect.setAttribute("height", String(Math.max(0.001, b.h * bp)));
        rect.setAttribute("fill-opacity", String(0.3 + 0.6 * bp));
      });
    } else {
      const main = mainPathRef.current;
      main?.setAttribute("stroke-dashoffset", String(1 - p));
      const hot = hotPathRef.current;
      const midDraw = p > 0.001 && p < 0.995;
      if (hot) { hot.setAttribute("stroke-dashoffset", String(HOT - p)); hot.setAttribute("opacity", midDraw ? "0.9" : "0"); }
      clipRectRef.current?.setAttribute("width", String(p * size.w));
      if (main && tipDotRef.current) {
        if (lenCacheRef.current.d !== geo.dLine) { lenCacheRef.current = { d: geo.dLine, len: main.getTotalLength() }; }
        const pt = main.getPointAtLength(Math.min(0.9995, p) * lenCacheRef.current.len);
        tipDotRef.current.setAttribute("cx", String(pt.x));
        tipDotRef.current.setAttribute("cy", String(pt.y));
        tipDotRef.current.setAttribute("opacity", midDraw ? "1" : "0");
      }
    }
    if (raw >= 1) { drawDoneRef.current = true; setDrawn(true); }
  }, [drawDuration, ease, geo, size.w, variant]);

  const containerRef = useVisibilityPause<HTMLSpanElement>(tick, { paused: paused || reducedMotion || drawn });

  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setSize((s) => (Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5 ? s : { w: r.width, h: r.height })); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  const n = points.length;
  const dotX = geo.xs[n - 1];
  const dotY = geo.ys[n - 1];

  return (
    <span ref={containerRef} data-crucible="scriber" aria-hidden={label ? undefined : true} className={cn("relative inline-block w-full", className)} {...props}>
      <svg className="block h-full w-full overflow-hidden" aria-hidden focusable="false">
        {variant === "area" && (
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={fillColor} stopOpacity={fillDirection === "down" ? fillOpacity : 0} />
              <stop offset="1" stopColor={fillColor} stopOpacity={fillDirection === "down" ? 0 : fillOpacity} />
            </linearGradient>
            {!isDrawn && (<clipPath id={clipId}><rect ref={clipRectRef} x="0" y="0" width={0} height={size.h} /></clipPath>)}
          </defs>
        )}
        {variant === "bars" ? (
          <>
            <line x1={geo.pad} x2={size.w - geo.pad} y1={geo.baseY} y2={geo.baseY} stroke={trackColor} strokeWidth={1} />
            <g>
              {geo.bars.map((b, i) => (
                <rect key={i} ref={(el) => { barRefs.current[i] = el; }} x={b.x} width={b.w} y={isDrawn ? b.y : geo.baseY} height={isDrawn ? b.h : 0.001} rx={Math.min(1, b.w / 2)} fill={stroke} fillOpacity={isDrawn ? 0.9 : 0} />
              ))}
            </g>
          </>
        ) : (
          <g>
            <path d={geo.dLine} fill="none" stroke={trackColor} strokeWidth={Math.max(1, strokeWidth - 0.25)} />
            {variant === "area" && <path d={geo.dArea} fill={`url(#${gradId})`} clipPath={isDrawn ? undefined : `url(#${clipId})`} />}
            <path ref={mainPathRef} d={geo.dLine} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" pathLength={1} {...(isDrawn ? {} : { strokeDasharray: "1", strokeDashoffset: 1 })} />
            {!isDrawn && <path ref={hotPathRef} d={geo.dLine} fill="none" stroke={tipColor} strokeWidth={strokeWidth + 0.5} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={`${HOT} 1`} strokeDashoffset={HOT} opacity={0} />}
          </g>
        )}
        {!isDrawn && variant !== "bars" && <circle ref={tipDotRef} r={Math.max(1.5, strokeWidth * 0.9 + 0.6)} fill={tipColor} opacity={0} />}
        {isDrawn && (
          <>
            <circle ref={dotHaloRef} cx={dotX} cy={dotY} r={dotR * 2} fill={dotColor} opacity={0.14} />
            <circle ref={dotRef} cx={dotX} cy={dotY} r={dotR} fill={dotColor} />
          </>
        )}
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
