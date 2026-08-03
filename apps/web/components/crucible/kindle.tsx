"use client";

import * as React from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

export interface KindleProps extends React.ComponentPropsWithoutRef<"div"> {
  children: React.ReactNode;
  color?: string;
  rimColor?: string;
  radius?: number;
  borderGlow?: boolean;
}

export function Kindle({
  children, className, style, color = "rgba(255,255,255,0.45)", rimColor = "rgba(255,255,255,0.25)",
  radius = 240, borderGlow = true, ...props
}: KindleProps) {
  const reducedMotion = useReducedMotion();
  const nodeRef = React.useRef<HTMLDivElement>(null);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (reducedMotion) return;
    const node = nodeRef.current; if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--kindle-x", `${((event.clientX - rect.left) / rect.width * 100).toFixed(2)}%`);
    node.style.setProperty("--kindle-y", `${((event.clientY - rect.top) / rect.height * 100).toFixed(2)}%`);
  }, [reducedMotion]);

  const handlePointerEnter = React.useCallback(() => { if (!reducedMotion) nodeRef.current?.setAttribute("data-hover", "true"); }, [reducedMotion]);
  const handlePointerLeave = React.useCallback(() => { nodeRef.current?.setAttribute("data-hover", "false"); }, []);

  return (
    <div ref={nodeRef} data-crucible="kindle" data-hover="false" data-reduced-motion={reducedMotion}
      onPointerMove={handlePointerMove} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}
      className={cn("group relative overflow-hidden rounded-xl border border-hair bg-panel", className)}
      style={{
        ["--kindle-color" as string]: color,
        ["--kindle-rim" as string]: rimColor,
        ["--kindle-radius" as string]: `${radius}px`,
        ["--kindle-haze-radius" as string]: `${radius * 1.5}px`,
        ["--kindle-x" as string]: "50%",
        ["--kindle-y" as string]: "30%",
        ...style,
      } as React.CSSProperties}
      {...props}
    >
      <style>{`
        @property --kindle-x { syntax: "<percentage>"; inherits: true; initial-value: 50%; }
        @property --kindle-y { syntax: "<percentage>"; inherits: true; initial-value: 30%; }
        [data-crucible="kindle"] { isolation: isolate; transition: --kindle-x 240ms cubic-bezier(0.22,1,0.36,1), --kindle-y 240ms cubic-bezier(0.22,1,0.36,1); }
        [data-crucible="kindle"] .kindle-bevel, [data-crucible="kindle"] .kindle-rest, [data-crucible="kindle"] .kindle-sheen,
        [data-crucible="kindle"] .kindle-core, [data-crucible="kindle"] .kindle-haze, [data-crucible="kindle"] .kindle-border {
          position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
        }
        [data-crucible="kindle"] .kindle-bevel {
          box-shadow: inset 0 1px 0 color-mix(in oklab, var(--kindle-rim) 55%, transparent),
                      inset 0 -1px 0 rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.02);
          background: radial-gradient(135% 120% at 50% -20%, transparent 55%, rgba(0,0,0,0.22) 100%);
        }
        [data-crucible="kindle"] .kindle-rest {
          opacity: 1; transform-origin: 50% -10%;
          background: radial-gradient(120% 80% at 50% -18%, color-mix(in oklab, var(--kindle-rim) 28%, transparent), transparent 70%);
          animation: kindle-breathe 6400ms ease-in-out infinite;
          transition: opacity 400ms ease;
        }
        [data-crucible="kindle"][data-hover="true"] .kindle-rest { opacity: 0.4; }
        [data-crucible="kindle"] .kindle-haze {
          opacity: 0;
          background: radial-gradient(var(--kindle-haze-radius) circle at var(--kindle-x) var(--kindle-y),
            color-mix(in oklab, var(--kindle-rim) 30%, transparent), transparent 78%);
          mix-blend-mode: screen; transition: opacity 350ms ease;
        }
        [data-crucible="kindle"] .kindle-core {
          opacity: 0;
          background: radial-gradient(calc(var(--kindle-radius) * 0.58) circle at var(--kindle-x) var(--kindle-y),
            color-mix(in oklab, var(--kindle-color) 68%, white), transparent 76%);
          mix-blend-mode: screen; transition: opacity 350ms ease;
        }
        [data-crucible="kindle"] .kindle-border {
          opacity: 0; padding: 1px;
          background: radial-gradient(calc(var(--kindle-radius) * 0.95) circle at var(--kindle-x) var(--kindle-y),
            color-mix(in oklab, var(--kindle-color) 40%, white), transparent 64%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude; transition: opacity 350ms ease;
        }
        [data-crucible="kindle"][data-hover="true"] .kindle-core,
        [data-crucible="kindle"][data-hover="true"] .kindle-haze,
        [data-crucible="kindle"][data-hover="true"] .kindle-border { opacity: 1; }
        @keyframes kindle-breathe { 0%,100% { opacity:0.72; transform:scale(1); } 50% { opacity:1; transform:scale(1.03); } }
        [data-crucible="kindle"][data-reduced-motion="true"] .kindle-rest { animation: none; opacity: 0.6; }
      `}</style>
      <div className="kindle-bevel" aria-hidden />
      <div className="kindle-rest" aria-hidden />
      <div className="kindle-haze" aria-hidden />
      <div className="kindle-core" aria-hidden />
      {borderGlow && <div className="kindle-border" aria-hidden />}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
