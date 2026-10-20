"use client";

import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Calm, collapsible glass card: the header summarises, the body holds the detail. */
export function ExpandableCard({ title, subtitle, icon, aside, children, defaultOpen = false, className, tone = "glass" }: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  tone?: "glass" | "card";
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const reduce = useReducedMotion();
  return (
    <section className={cn(tone === "glass" ? "glass" : "bg-card shadow-soft", "rounded-[1.75rem] transition-shadow hover:shadow-lift", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-3 rounded-[1.75rem] p-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber/25 sm:px-5"
      >
        {icon && <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-amber-soft text-ink [&_svg]:size-5">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-ink-2">{subtitle}</span>}
        </span>
        {aside && <span className="shrink-0">{aside}</span>}
        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-300", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key="body"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 32 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-5 sm:px-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
