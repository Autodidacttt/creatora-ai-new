"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { compact } from "@/lib/utils";

/** Counts up to `value` when scrolled into view (instant for reduced-motion users). */
export function Counter({ value, className, format = "compact", formatter }: {
  value: number;
  className?: string;
  format?: "compact" | "plain";
  /** Custom display (e.g. percentages, currency); receives the animated, unrounded value */
  formatter?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const shown = useRef(value);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(reduce ? value : shown.current === value ? 0 : shown.current, value, {
      duration: reduce ? 0 : 1.1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
      onComplete: () => { shown.current = value; },
    });
    return () => controls.stop();
  }, [value, inView, reduce]);

  const n = Math.round(display);
  const text = formatter ? formatter(display) : format === "compact" ? compact(n) : n.toLocaleString();
  return <span ref={ref} className={className}>{text}</span>;
}
