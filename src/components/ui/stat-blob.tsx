import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Counter } from "./counter";

/** Notched white stat tile with a big animated number and the small amber ↗ badge. */
export function StatBlob({ value, label, href, className, accent }: {
  value: number;
  label: ReactNode;
  href?: string;
  className?: string;
  accent?: boolean;
}) {
  const body = (
    <div className={cn("relative h-full")}>
      <div
        className={cn(
          "notched h-full rounded-[1.75rem] p-4 transition-transform duration-300 group-hover:-translate-y-0.5",
          accent ? "bg-amber text-on-amber shadow-[0_14px_40px_-16px_var(--glow)]" : "bg-card text-ink shadow-soft ring-1 ring-inset ring-line group-hover:ring-amber/35",
        )}
      >
        <Counter value={value} className="display block text-3xl tabular-nums sm:text-4xl" />
        <span className={cn("mt-1 block text-xs", accent ? "text-on-amber/75" : "text-ink-2")}>{label}</span>
      </div>
      <span
        aria-hidden
        className="absolute -right-1 -top-1 grid size-8 place-items-center rounded-full bg-amber text-on-amber shadow-md transition-transform duration-300 group-hover:rotate-45"
      >
        <ArrowUpRight className="size-4" />
      </span>
    </div>
  );
  return href ? (
    <Link href={href} className={cn("group block", className)}>{body}</Link>
  ) : (
    <div className={cn("group", className)}>{body}</div>
  );
}
