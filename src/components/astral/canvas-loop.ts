"use client";

import { useEffect, useRef, type RefObject } from "react";

export interface SkyColors {
  /** "r, g, b" of starlight (theme-aware) */
  star: string;
  /** "r, g, b" of the amber star glow */
  glow: string;
}

export interface FrameInfo {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** seconds since start (frozen at 0 when static) */
  t: number;
  /** seconds since the previous frame, capped */
  dt: number;
  colors: SkyColors;
}

function readColors(): SkyColors {
  const s = getComputedStyle(document.documentElement);
  return {
    star: s.getPropertyValue("--star-rgb").trim() || "226, 230, 255",
    glow: s.getPropertyValue("--glow-rgb").trim() || "255, 192, 46",
  };
}

/**
 * Shared 2D-canvas driver for the sky effects: devicePixelRatio cap, ResizeObserver sizing, theme-aware colours,
 * requestAnimationFrame with an fps cap, and automatic pausing when the tab is hidden or the canvas is offscreen.
 * With `animate: false` it draws a single static frame (reduced effects / reduced motion) and redraws on resize/theme.
 */
export function useCanvasLoop(
  ref: RefObject<HTMLCanvasElement | null>,
  { enabled = true, animate, draw, onResize, fps = 60, maxDpr = 1.5 }: {
    /** false when the canvas isn't rendered (effects off) */
    enabled?: boolean;
    animate: boolean;
    draw: (f: FrameInfo) => void;
    onResize?: (w: number, h: number) => void;
    fps?: number;
    maxDpr?: number;
  },
) {
  const drawRef = useRef(draw);
  const resizeRef = useRef(onResize);
  useEffect(() => {
    drawRef.current = draw;
    resizeRef.current = onResize;
  });

  useEffect(() => {
    const canvas = ref.current;
    const ctx = enabled ? canvas?.getContext("2d") : null;
    if (!canvas || !ctx) return;

    let w = 0, h = 0, raf = 0, last = 0, t = 0;
    let colors = readColors();
    let onScreen = true;
    const minGap = 1000 / fps - 1;

    const paint = (dt: number) => drawRef.current({ ctx, w, h, t, dt, colors });

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resizeRef.current?.(w, h);
      if (!animate) paint(0);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < minGap) return;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      t += dt;
      paint(dt);
    };
    const start = () => {
      if (!animate || raf || document.hidden || !onScreen) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    size();
    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting;
      if (onScreen) start(); else stop();
    });
    io.observe(canvas);
    const mo = new MutationObserver(() => {
      colors = readColors();
      if (!animate) paint(0);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ref, enabled, animate, fps, maxDpr]);
}

/** Pointer position in viewport pixels, tracked passively (null until the pointer moves). */
export function usePointer(enabled: boolean) {
  const p = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const move = (e: PointerEvent) => { p.current = { x: e.clientX, y: e.clientY }; };
    const leave = () => { p.current = null; };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, [enabled]);
  return p;
}

export const TAU = Math.PI * 2;
export const isSmallScreen = () => typeof window !== "undefined" && window.innerWidth < 768;
