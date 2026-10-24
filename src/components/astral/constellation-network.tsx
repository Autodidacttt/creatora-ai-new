"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useEffects } from "./effects";
import { TAU, isSmallScreen, useCanvasLoop, usePointer } from "./canvas-loop";

interface Node { x: number; y: number; vx: number; vy: number; r: number; brand: boolean; ph: number; lit: number }

/**
 * Drifting constellation of creator (round) and brand (diamond) nodes. Edges form between near neighbours and
 * light up in amber around the cursor (or the last tap on touch). Static single frame with reduced effects.
 */
export function ConstellationNetwork({ className, density = 1, reach = 170 }: {
  className?: string;
  /** node count multiplier */
  density?: number;
  /** cursor influence radius in px */
  reach?: number;
}) {
  const { level } = useEffects();
  const ref = useRef<HTMLCanvasElement>(null);
  const nodes = useRef<Node[]>([]);
  const animate = level === "full";
  const pointer = usePointer(animate);

  useCanvasLoop(ref, {
    enabled: level !== "off",
    animate,
    fps: 60,
    onResize: (w, h) => {
      const small = isSmallScreen();
      const want = Math.round(Math.min(small ? 34 : 86, Math.max(16, (w * h) / (small ? 15_000 : 15_500))) * density);
      const list = nodes.current;
      for (const n of list) { n.x = Math.min(n.x, w); n.y = Math.min(n.y, h); }
      while (list.length < want) {
        list.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9,
          r: 1 + Math.random() * 1.6, brand: Math.random() < 0.28, ph: Math.random() * TAU, lit: 0,
        });
      }
      list.length = want;
    },
    draw: ({ ctx, w, h, t, dt, colors }) => {
      ctx.clearRect(0, 0, w, h);
      const list = nodes.current;
      const rect = ref.current?.getBoundingClientRect();
      const p = pointer.current && rect ? { x: pointer.current.x - rect.left, y: pointer.current.y - rect.top } : null;
      const link = Math.max(90, Math.min(170, Math.min(w, h) * 0.2));

      for (const n of list) {
        if (dt) {
          n.x += n.vx * dt;
          n.y += n.vy * dt;
          if (n.x < 0 || n.x > w) n.vx *= -1;
          if (n.y < 0 || n.y > h) n.vy *= -1;
        }
        const d = p ? Math.hypot(n.x - p.x, n.y - p.y) : Infinity;
        const target = d < reach ? 1 - d / reach : 0;
        n.lit += (target - n.lit) * (dt ? Math.min(1, dt * 6) : 1);
        // a gentle pull toward the cursor
        if (p && d < reach && d > 1 && dt) {
          n.x += ((p.x - n.x) / d) * 6 * dt;
          n.y += ((p.y - n.y) / d) * 6 * dt;
        }
      }

      ctx.lineWidth = 0.8;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          if (Math.abs(dx) > link || Math.abs(dy) > link) continue;
          const d = Math.hypot(dx, dy);
          if (d > link) continue;
          const k = 1 - d / link;
          const lit = Math.max(a.lit, b.lit) * Math.min(a.lit, b.lit) ** 0.3;
          ctx.strokeStyle = lit > 0.02
            ? `rgba(${colors.glow}, ${k * (0.12 + 0.6 * lit)})`
            : `rgba(${colors.star}, ${k * 0.13})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const n of list) {
        const pulse = animate ? 0.5 + 0.5 * Math.sin(t * 1.4 + n.ph) : 0.6;
        const rgb = n.lit > 0.05 || n.brand ? colors.glow : colors.star;
        const alpha = 0.45 + 0.35 * pulse + 0.2 * n.lit;
        const r = n.r * (1 + n.lit * 0.9);
        if (n.lit > 0.05) {
          ctx.fillStyle = `rgba(${colors.glow}, ${0.18 * n.lit})`;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 5, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${rgb}, ${alpha})`;
        ctx.beginPath();
        if (n.brand) {
          const s = r * 1.5;
          ctx.moveTo(n.x, n.y - s); ctx.lineTo(n.x + s, n.y); ctx.lineTo(n.x, n.y + s); ctx.lineTo(n.x - s, n.y);
          ctx.closePath();
        } else {
          ctx.arc(n.x, n.y, r, 0, TAU);
        }
        ctx.fill();
      }
    },
  });

  if (level === "off") return null;
  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)} />;
}
