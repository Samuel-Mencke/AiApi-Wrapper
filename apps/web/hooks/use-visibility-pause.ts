"use client";

import * as React from "react";

interface Options {
  paused?: boolean;
}

/**
 * A rAF hook that pauses when offscreen, on hidden tabs, or when `paused` is true.
 * The callback receives elapsed seconds since the hook started.
 */
export function useVisibilityPause<T extends Element>(
  callback: (elapsed: number) => void,
  { paused = false }: Options = {}
) {
  const ref = React.useRef<T>(null);
  const cbRef = React.useRef(callback);
  cbRef.current = callback;

  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || paused) {
      setActive(false);
      return;
    }

    let raf = 0;
    let startTime = 0;
    let running = false;

    const tick = (now: number) => {
      if (!running) return;
      if (startTime === 0) startTime = now;
      cbRef.current((now - startTime) / 1000);
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      startTime = 0;
      raf = requestAnimationFrame(tick);
      setActive(true);
    };

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      setActive(false);
    };

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]!;
        if (entry.isIntersecting && !document.hidden) start();
        else stop();
      },
      { threshold: 0.01 }
    );
    io.observe(el);

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [paused]);

  return ref;
}
