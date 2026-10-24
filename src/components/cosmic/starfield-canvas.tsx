"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useEffects } from "./effects";
import { TAU, isSmallScreen, useCanvasLoop, usePointer } from "./canvas-loop";
import { createShootingStars, type ShootingStars } from "./shooting-stars";

interface Star { x: number; y: number; r: number; a: number; tw: number; ph: number; z: number; warm: boolean }

export interface StarfieldProps {
  /** Stars per 10,000 px² (halved on small screens) */
  density?: number;
  /** Horizontal drift in px/s for the nearest layer (0 = still) */
  drift?: number;
  /** Twinkle amount 0–1 */
  twinkle?: number;
  /** Pointer parallax in px for the nearest layer (fine pointers + full effects only) */
  parallax?: number;
  /** Scroll parallax: px of star movement per px scrolled, for the nearest layer (far stars move less) */
  scrollParallax?: number;
  /** Overall opacity multiplier */
  brightness?: number;
  /** Rare shooting stars: [minGap, maxGap] seconds (full effects only), drawn on this same canvas */
  meteors?: [number, number] | null;
  /** Shooting-star brightness multiplier */
  meteorIntensity?: number;
  /** Never animate, even with full effects (admin) */
  still?: boolean;
  fps?: number;
  className?: string;
}

/**
 * Quiet, twinkling starfield on a 2D canvas with depth-scaled scroll parallax and optional rare shooting stars — one
 * canvas for the whole sky (fewer composited layers under the glass). Decorative: aria-hidden, no pointer events.
 */
export function StarfieldCanvas({
  density = 1.2, drift = 3, twinkle = 0.5, parallax = 0, scrollParallax = 0, meteors = null, meteorIntensity = 1, brightness = 1, still = false, fps = 30, className,
}: StarfieldProps) {
  const { level } = useEffects();
  const ref = useRef<HTMLCanvasElement>(null);
  const stars = useRef<Star[]>([]);
  const animate = level === "full" && !still;
  const pointer = usePointer(animate && parallax > 0);
  const off = useRef({ x: 0, y: 0 });
  const scroll = useRef(0);
  const shooting = useRef<ShootingStars | null>(null);
  useEffect(() => {
    shooting.current = animate && meteors ? createShootingStars(meteors[0], meteors[1], meteorIntensity) : null;
  }, [animate, meteors, meteorIntensity]);

  useEffect(() => {
    if (!animate || !scrollParallax) return;
    const on = () => { scroll.current = window.scrollY; };
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [animate, scrollParallax]);

  useCanvasLoop(ref, {
    enabled: level !== "off",
    animate,
    fps,
    onResize: (w, h) => {
      const want = Math.round(((w * h) / 10_000) * density * (isSmallScreen() ? 0.5 : 1));
      const list = stars.current;
      // Keep existing stars (positions are normalised) so a mobile URL-bar resize doesn't reshuffle the sky
      while (list.length < want) {
        const z = 0.25 + Math.random() ** 2 * 0.75;
        list.push({
          x: Math.random(), y: Math.random(), z,
          r: 0.35 + z * (Math.random() < 0.06 ? 1.4 : 0.8),
          a: 0.25 + Math.random() * 0.6,
          tw: 0.4 + Math.random() * 1.6, ph: Math.random() * TAU,
          warm: Math.random() < 0.06,
        });
      }
      list.length = Math.min(list.length, want);
    },
    draw: ({ ctx, w, h, t, dt, colors }) => {
      ctx.clearRect(0, 0, w, h);
      const p = pointer.current;
      const tx = p && parallax ? (p.x / w - 0.5) * -parallax : 0;
      const ty = p && parallax ? (p.y / h - 0.5) * -parallax : 0;
      off.current.x += (tx - off.current.x) * 0.05;
      off.current.y += (ty - off.current.y) * 0.05;
      const sy = scroll.current * scrollParallax;
      for (const s of stars.current) {
        if (drift && dt) {
          s.x -= (drift * s.z * dt) / w;
          if (s.x < -0.01) s.x += 1.02;
        }
        const tw = twinkle ? 1 - twinkle * 0.5 * (1 + Math.sin(t * s.tw + s.ph)) * (animate ? 1 : 0.5) : 1;
        const alpha = s.a * tw * brightness;
        if (alpha < 0.02) continue;
        const x = s.x * w + off.current.x * s.z;
        // wrap vertically so scroll parallax never runs out of sky
        const y = ((((s.y * h - sy * s.z + off.current.y * s.z) % h) + h) % h);
        ctx.fillStyle = `rgba(${s.warm ? colors.glow : colors.star}, ${alpha})`;
        if (s.r < 0.8) {
          ctx.fillRect(x, y, s.r * 1.6, s.r * 1.6);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, s.r, 0, TAU);
          ctx.fill();
          if (s.r > 1.15) {
            ctx.fillStyle = `rgba(${s.warm ? colors.glow : colors.star}, ${alpha * 0.12})`;
            ctx.beginPath();
            ctx.arc(x, y, s.r * 3.2, 0, TAU);
            ctx.fill();
          }
        }
      }
      if (dt) shooting.current?.step(ctx, w, h, dt, colors.star);
    },
  });

  if (level === "off") return null;
  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
