"use client";

import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { cn } from "@/lib/utils";
import { SPRING } from "@/lib/motion";
import { useEffects, useFinePointerFx } from "./effects";

const FOLLOW = { stiffness: SPRING.gentle.stiffness, damping: SPRING.gentle.damping, mass: SPRING.gentle.mass };

/**
 * Glass card with a cursor-following glow and an optional subtle 3D tilt (fine pointers + full effects only).
 * The glow is a CSS radial gradient driven by two custom properties, so it costs no re-renders.
 */
export function GlowCard({ children, className, tilt = false, strong, ...props }: HTMLAttributes<HTMLDivElement> & { tilt?: boolean; strong?: boolean }) {
  const fx = useFinePointerFx();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), FOLLOW);
  const ry = useSpring(useMotionValue(0), FOLLOW);

  return (
    <motion.div
      ref={ref}
      style={tilt && fx ? { rotateX: rx, rotateY: ry, transformPerspective: 900 } : undefined}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || !fx) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.style.setProperty("--gx", `${x * 100}%`);
        el.style.setProperty("--gy", `${y * 100}%`);
        if (tilt) { rx.set((0.5 - y) * 6); ry.set((x - 0.5) * 8); }
      }}
      onPointerLeave={() => { rx.set(0); ry.set(0); }}
      className={cn(strong ? "glass-strong" : "glass", "glow-hover group/glow relative overflow-hidden rounded-[2rem]", className)}
      {...(props as object)}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/glow:opacity-100"
        style={{ background: "radial-gradient(420px circle at var(--gx, 50%) var(--gy, 0%), rgba(var(--glow-rgb), 0.1), transparent 60%)" }}
      />
      {children}
    </motion.div>
  );
}

/** Pulls its child gently toward the cursor (springs back on leave). No-op on touch / reduced effects. */
export function MagneticButton({ children, strength = 10, className }: { children: ReactNode; strength?: number; className?: string }) {
  const fx = useFinePointerFx();
  const ref = useRef<HTMLSpanElement>(null);
  const x = useSpring(0, FOLLOW);
  const y = useSpring(0, FOLLOW);
  return (
    <motion.span
      ref={ref}
      style={fx ? { x, y } : undefined}
      className={cn("inline-flex", className)}
      onPointerMove={(e) => {
        if (!fx || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set(((e.clientX - r.left) / r.width - 0.5) * strength * 2);
        y.set(((e.clientY - r.top) / r.height - 0.5) * strength * 2);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.span>
  );
}

/** Primary action wrapper: magnetic pull plus a soft amber halo that brightens on hover. Use on key actions only. */
export function GlowButton({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <MagneticButton className={cn("group/glowbtn relative", className)}>
      <span aria-hidden className="pointer-events-none absolute -inset-2 rounded-full bg-[radial-gradient(closest-side,rgba(var(--glow-rgb),0.28),transparent)] opacity-50 blur-md transition-opacity duration-500 group-hover/glowbtn:opacity-100" />
      <span className="relative inline-flex">{children}</span>
    </MagneticButton>
  );
}

/** Scroll-triggered reveal: fades up out of a soft blur (opacity only with reduced effects). */
export function ScrollReveal({ children, className, delay = 0, y = 24, as = "div" }: {
  children: ReactNode; className?: string; delay?: number; y?: number; as?: "div" | "section" | "li";
}) {
  const { level } = useEffects();
  const full = level === "full";
  const M = motion[as];
  if (level === "off") {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <M
      className={className}
      initial={full ? { opacity: 0, y, filter: "blur(8px)" } : { opacity: 0 }}
      whileInView={full ? { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } } : { opacity: 1 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ ...SPRING.gentle, delay, filter: { duration: 0.5, delay } }}
    >
      {children}
    </M>
  );
}
