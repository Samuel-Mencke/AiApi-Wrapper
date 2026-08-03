"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

export interface SemaphoreSegment { status: string; label?: string; detail?: string; }
export interface SemaphoreRow { label?: string; segments: SemaphoreSegment[]; }
export interface SemaphoreStatusStyle { color: string; opacity?: number; notch?: boolean; emphasis?: boolean; }
export interface SemaphoreProps extends Omit<React.ComponentPropsWithoutRef<"div">, "children"> {
  segments?: SemaphoreSegment[];
  rows?: SemaphoreRow[];
  colors?: Record<string, string | SemaphoreStatusStyle>;
  cascade?: boolean;
  cascadeSpeed?: number;
  pulse?: boolean;
  segmentWidth?: number;
  segmentHeight?: number;
  gap?: number;
  radius?: number;
  axis?: readonly [string, string];
  showChip?: boolean;
  paused?: boolean;
}

const DEFAULT_STATUS_STYLES: Record<string, Required<SemaphoreStatusStyle>> = {
  operational: { color: "#26c48d", opacity: 0.55, notch: false, emphasis: false },
  degraded: { color: "#e0a83e", opacity: 0.85, notch: true, emphasis: false },
  incident: { color: "#ef7373", opacity: 1, notch: false, emphasis: true },
  empty: { color: "#5c636e", opacity: 0.14, notch: false, emphasis: false },
};

function resolveStatusStyle(status: string, colors: SemaphoreProps["colors"]): Required<SemaphoreStatusStyle> {
  const base = DEFAULT_STATUS_STYLES[status] ?? DEFAULT_STATUS_STYLES.operational!;
  const user = colors?.[status];
  if (typeof user === "string") return { ...base, color: user };
  if (user) return { ...base, ...user };
  return base;
}

const STYLE = `
[data-crucible="semaphore"] .sem-seg { position:relative; flex:none; width:var(--sem-w); height:var(--sem-h); border-radius:var(--sem-r); opacity:var(--seg-o,1); }
[data-crucible="semaphore"] .sem-notch { position:absolute; left:0; right:0; top:30%; height:2px; background:rgba(8,10,14,.9); }
@keyframes sem-ignite { 0% { opacity:0; filter:brightness(.4); transform:scaleY(.25); } 45% { opacity:1; filter:brightness(2.1); transform:scaleY(1.05); } 100% { transform:scaleY(1); } }
@keyframes sem-pulse { 0%,100% { opacity:var(--seg-o,1); filter:brightness(1); } 50% { opacity:1; filter:brightness(1.45); } }
@keyframes sem-chip { 0% { opacity:0; transform:translate(-50%,3px); } }
[data-crucible="semaphore"][data-boot="pending"] .sem-seg { opacity:0; }
[data-crucible="semaphore"][data-boot="go"] .sem-seg { animation:sem-ignite var(--sem-ignite) cubic-bezier(.2,.7,.3,1) var(--seg-delay,0s) backwards; }
[data-crucible="semaphore"][data-boot="done"][data-pulse="true"] .sem-latest { animation:sem-pulse 2.4s ease-in-out infinite; }
[data-crucible="semaphore"] .sem-chip { position:absolute; bottom:calc(100% + 8px); transform:translateX(-50%); z-index:20; pointer-events:none; white-space:nowrap; animation:sem-chip .16s ease-out; }
@media (prefers-reduced-motion:reduce) { [data-crucible="semaphore"] .sem-seg { animation:none!important; opacity:var(--seg-o,1)!important; } }
`;

export function Semaphore({
  segments, rows, colors, cascade = true, cascadeSpeed = 1, pulse = true,
  segmentWidth = 6, segmentHeight = 26, gap = 3, radius = 2, axis, showChip = true,
  paused = false, className, style, ...rest
}: SemaphoreProps) {
  const reducedMotion = useReducedMotion();
  const shownRows = React.useMemo(() => rows ?? (segments ? [{ segments }] : []), [rows, segments]);
  const maxCols = Math.max(1, ...shownRows.map((r) => r.segments.length));
  const speed = Math.max(cascadeSpeed, 0.05);
  const colStepS = 0.5 / speed / Math.max(1, maxCols - 1);
  const igniteS = 0.35 / speed;
  const [boot, setBoot] = React.useState<"pending" | "go" | "done">(cascade && !reducedMotion ? "pending" : "done");
  const hostRef = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<{ row: number; index: number } | null>(null);

  React.useEffect(() => {
    if (!cascade || reducedMotion) { setBoot("done"); return; }
    const el = hostRef.current; if (!el) return;
    let timeout = 0;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0]!;
      if (!entry.isIntersecting) return;
      io.disconnect(); setBoot("go");
      timeout = window.setTimeout(() => setBoot("done"), ((maxCols - 1) * colStepS + igniteS) * 1000 + 120);
    }, { threshold: 0.25 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timeout); };
  }, [cascade, reducedMotion, maxCols, colStepS, igniteS]);

  const hasLabels = shownRows.some((r) => r.label);
  const vars = { "--sem-w": `${segmentWidth}px`, "--sem-h": `${segmentHeight}px`, "--sem-r": `${Math.max(0, radius)}px`, "--sem-ignite": `${igniteS.toFixed(3)}s`, ...style } as React.CSSProperties;

  return (
    <div {...rest} ref={hostRef} data-crucible="semaphore" data-boot={boot} data-pulse={pulse && !reducedMotion && !paused ? "true" : "false"}
      className={cn("inline-grid items-center gap-x-3 gap-y-2.5", hasLabels ? "grid-cols-[auto_1fr]" : "grid-cols-1", className)} style={vars}>
      <style>{STYLE}</style>
      {shownRows.map((row, ri) => {
        const chip = showChip && hover?.row === ri ? row.segments[hover.index] : undefined;
        return <React.Fragment key={ri}>
          {hasLabels && <span className="text-[11px] font-medium text-faint">{row.label}</span>}
          <div className="relative min-w-0 overflow-visible">
            <div aria-hidden className="flex items-center overflow-hidden" style={{ gap: `${gap}px` }}
              onMouseOver={showChip ? (e) => { const target = (e.target as HTMLElement).closest<HTMLElement>("[data-sem-idx]"); if (target) setHover({ row: ri, index: Number(target.dataset.semIdx) }); } : undefined}
              onMouseLeave={showChip ? () => setHover(null) : undefined}>
              {row.segments.map((seg, i) => {
                const st = resolveStatusStyle(seg.status, colors);
                const isLatest = i === row.segments.length - 1;
                return <span key={i} data-sem-idx={i} className={cn("sem-seg", isLatest && "sem-latest")}
                  style={{ backgroundColor: st.color, "--seg-o": st.opacity, "--seg-delay": `${(i * colStepS + ri * .035 / speed).toFixed(3)}s`, ...(st.emphasis ? { boxShadow: `0 0 9px color-mix(in oklab, ${st.color} 55%, transparent)`, transform: "scaleY(1.16)" } : {}) } as React.CSSProperties}>
                  {st.notch && <span className="sem-notch" />}
                </span>;
              })}
            </div>
            {chip && hover && <div aria-hidden className="sem-chip rounded-md border border-line bg-elevated px-2.5 py-1.5 text-[11px] text-dim shadow-xl shadow-black/40"
              style={{ left: hover.index * (segmentWidth + gap) + segmentWidth / 2 }}>
              <span className="font-medium capitalize text-ink">{chip.status}</span>{chip.label && <span className="ml-2 text-faint">{chip.label}</span>}
              {chip.detail && <span className="mt-0.5 block text-faint">{chip.detail}</span>}
            </div>}
          </div>
        </React.Fragment>;
      })}
      {axis && <>{hasLabels && <span aria-hidden />}<div aria-hidden className="flex justify-between text-[9px] uppercase tracking-[.14em] text-faint"><span>{axis[0]}</span><span>{axis[1]}</span></div></>}
    </div>
  );
}
