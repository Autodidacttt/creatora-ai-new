"use client";

import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { useEffects, useFinePointerFx } from "./effects";

export const SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;
const SOFT = { stiffness: 180, damping: 22, mass: 0.6 };

/**
 * Glass card with a cursor-following glow and an optional subtle 3D tilt (fine pointers + full effects only).
 * The glow is a CSS radial gradient driven by two custom properties, so it costs no re-renders.
 */
export function GlowCard({ children, className, tilt = false, strong, ...props }: HTMLAttributes<HTMLDivElement> & { tilt?: boolean; strong?: boolean }) {
  const fx = useFinePointerFx();
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(useMotionValue(0), SOFT);
  const ry = useSpring(useMotionValue(0), SOFT);

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
      className={cn(
        strong ? "glass-strong" : "glass",
        "glow-hover group/glow relative overflow-hidden rounded-[2rem]",
        className,
      )}
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
  const x = useSpring(0, SOFT);
  const y = useSpring(0, SOFT);
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

/** Scroll-triggered reveal: fades up out of a soft blur (opacity only with reduced effects). */
export function ScrollReveal({ children, className, delay = 0, y = 28, as = "div" }: {
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
      transition={{ ...SPRING, delay, filter: { duration: 0.5, delay } }}
    >
      {children}
    </M>
  );
}

/** Parallax layer: moves at `speed` × scroll distance while its section passes the viewport (full effects only). */
export function Parallax({ children, speed = 0.15, className }: { children: ReactNode; speed?: number; className?: string }) {
  const { level } = useEffects();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [`${speed * 100}%`, `${-speed * 100}%`]);
  return (
    <motion.div ref={ref} style={level === "full" ? { y } : undefined} className={className}>
      {children}
    </motion.div>
  );
}

/** Thin amber page-scroll progress bar pinned to the top edge. */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className={cn("fixed inset-x-0 top-0 z-50 h-0.5 origin-left bg-gradient-to-r from-amber/40 via-amber to-amber shadow-[0_0_12px_var(--glow)]", className)}
    />
  );
}

/**
 * Lenis inertial scrolling for the page it is mounted on (landing only). Wheel input only — touch and keyboard keep
 * native scrolling — and anything inside [data-lenis-prevent], dialogs, menus or other nested scrollers is left alone.
 */
export function SmoothScroll() {
  const { level } = useEffects();
  useEffect(() => {
    if (level !== "full") return;
    let destroyed = false;
    let lenis: import("lenis").default | null = null;
    // A scroll key pressed mid-glide would otherwise be overridden by the glide: cancel it and let the browser scroll.
    const KEYS = new Set(["PageDown", "PageUp", "Home", "End", " ", "ArrowDown", "ArrowUp"]);
    const onKey = (e: KeyboardEvent) => {
      if (lenis?.isScrolling && KEYS.has(e.key)) { lenis.stop(); lenis.start(); }
    };
    import("lenis").then(({ default: Lenis }) => {
      if (destroyed) return;
      lenis = new Lenis({
        autoRaf: true,
        lerp: 0.1,
        // sections carry scroll-margin-top for the fixed header, which Lenis honours
        anchors: true,
        allowNestedScroll: true,
        prevent: (node) => !!node.closest("[data-lenis-prevent],[role=dialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper]"),
      });
      window.addEventListener("keydown", onKey, { capture: true });
    });
    return () => {
      destroyed = true;
      window.removeEventListener("keydown", onKey, { capture: true });
      lenis?.destroy();
    };
  }, [level]);
  return null;
}

/** Route transition used by the app/auth templates: a springy rise out of a soft blur (opacity only when reduced). */
export function PageTransition({ children }: { children: ReactNode }) {
  const { level } = useEffects();
  const full = level === "full";
  return (
    <motion.div
      initial={full ? { opacity: 0, y: 12, filter: "blur(6px)" } : { opacity: 0 }}
      // `filter: none` once settled: a lingering filter would become the containing block of fixed descendants (reels viewer)
      animate={full ? { opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } } : { opacity: 1 }}
      transition={{ ...SPRING, filter: { duration: 0.35 } }}
    >
      {children}
    </motion.div>
  );
}
