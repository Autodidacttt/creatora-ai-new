"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

/** Segmented pill tabs with a sliding amber indicator. Controlled; works with URL state. */
export function SegmentedTabs<T extends string>({ value, onChange, items, className, size = "md" }: {
  value: T;
  onChange: (value: T) => void;
  items: { value: T; label: string; count?: number }[];
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="tablist" className={cn("glass inline-flex max-w-full gap-1 overflow-x-auto rounded-full p-1 scrollbar-none", className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative shrink-0 rounded-full font-medium transition-colors",
              size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
              active ? "text-on-amber" : "text-ink-2 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`tab-${id}`}
                className="absolute inset-0 rounded-full bg-amber shadow-sm"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {item.label}
              {item.count !== undefined && (
                <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-on-amber/15" : "bg-ink/10")}>{item.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
