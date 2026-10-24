"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useEffects } from "./effects";
import { TAU, isSmallScreen, useCanvasLoop, usePointer } from "./canvas-loop";

interface Star { x: number; y: number; r: number; a: number; tw: number; ph: number; z: number; warm: boolean }
interface Meteor { x: number; y: number; vx: number; vy: number; life: number }

export interface StarfieldProps {
  /** Stars per 10,000 px² (halved on small screens) */
  density?: number;
  /** Horizontal drift in px/s for the nearest layer (0 = still) */
  drift?: number;
  /** Twinkle amount 0–1 */
  twinkle?: number;
  /** Pointer parallax in px for the nearest layer (fine pointers + full effects only) */
  parallax?: number;
  /** Occasional shooting stars (landing only) */
  meteors?: boolean;
  /** Overall opacity multiplier */
  brightness?: number;
  /** Never animate, even with full effects (admin) */
  still?: boolean;
  fps?: number;
  className?: string;
}

/** Drifting, twinkling starfield on a 2D canvas. Decorative: aria-hidden and pointer-events: none. */
export function StarfieldCanvas({
  density = 1.2, drift = 4, twinkle = 0.5, parallax = 0, meteors = false, brightness = 1, still = false, fps = 30, className,
}: StarfieldProps) {
  const { level } = useEffects();
  const ref = useRef<HTMLCanvasElement>(null);
  const stars = useRef<Star[]>([]);
  const meteor = useRef<Meteor | null>(null);
  const nextMeteor = useRef(4);
  const animate = level === "full" && !still;
  const pointer = usePointer(animate && parallax > 0);
  const off = useRef({ x: 0, y: 0 });

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
          r: 0.35 + z * (Math.random() < 0.06 ? 1.5 : 0.85),
          a: 0.25 + Math.random() * 0.6,
          tw: 0.4 + Math.random() * 1.6, ph: Math.random() * TAU,
          warm: Math.random() < 0.05,
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
      for (const s of stars.current) {
        if (drift && dt) {
          s.x -= (drift * s.z * dt) / w;
          if (s.x < -0.01) s.x += 1.02;
        }
        const tw = twinkle ? 1 - twinkle * 0.5 * (1 + Math.sin(t * s.tw + s.ph)) * (animate ? 1 : 0.5) : 1;
        const alpha = s.a * tw * brightness;
        if (alpha < 0.02) continue;
        const x = s.x * w + off.current.x * s.z;
        const y = s.y * h + off.current.y * s.z;
        ctx.fillStyle = `rgba(${s.warm ? colors.glow : colors.star}, ${alpha})`;
        if (s.r < 0.8) {
          ctx.fillRect(x, y, s.r * 1.6, s.r * 1.6);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, s.r, 0, TAU);
          ctx.fill();
          if (s.r > 1.2) {
            // a faint glint on the brightest stars
            ctx.fillStyle = `rgba(${s.warm ? colors.glow : colors.star}, ${alpha * 0.12})`;
            ctx.beginPath();
            ctx.arc(x, y, s.r * 3.2, 0, TAU);
            ctx.fill();
          }
        }
      }
      if (meteors && animate) drawMeteor(ctx, w, h, dt, colors.star);
    },
  });

  function drawMeteor(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, rgb: string) {
    nextMeteor.current -= dt;
    if (!meteor.current && nextMeteor.current <= 0) {
      meteor.current = { x: w * (0.3 + Math.random() * 0.7), y: h * Math.random() * 0.4, vx: -520, vy: 210, life: 1 };
      nextMeteor.current = 7 + Math.random() * 9;
    }
    const m = meteor.current;
    if (!m) return;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.life -= dt * 0.9;
    if (m.life <= 0) { meteor.current = null; return; }
    const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.18, m.y - m.vy * 0.18);
    g.addColorStop(0, `rgba(${rgb}, ${0.7 * m.life})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * 0.18, m.y - m.vy * 0.18);
    ctx.stroke();
  }

  if (level === "off") return null;
  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
