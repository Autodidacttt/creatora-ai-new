"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PillCTAProps {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  size?: "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  tone?: "light" | "dark";
}

/** Starlight pill CTA with the circular amber arrow — the signature button of the design. */
export function PillCTA({ children, href, onClick, className, size = "md", loading, disabled, type = "button", tone = "light" }: PillCTAProps) {
  const classes = cn(
    "group relative inline-flex items-center justify-between gap-4 overflow-hidden rounded-full font-medium transition-all duration-300",
    "hover:-translate-y-0.5 hover:shadow-lift disabled:pointer-events-none disabled:opacity-60",
    tone === "light"
      ? "bg-ink text-on-amber shadow-soft hover:shadow-[0_14px_44px_-14px_var(--glow)]"
      : "glass-strong text-ink",
    size === "lg" ? "h-16 pl-8 pr-2 text-lg" : "h-12 pl-5 pr-1.5 text-sm",
    className,
  );
  const content = (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent opacity-0 group-hover:animate-shine group-hover:opacity-100"
      />
      <span className="relative">{children}</span>
      <span
        className={cn(
          "relative grid place-items-center rounded-full bg-amber text-on-amber shadow-[0_0_18px_-2px_var(--glow)] transition-transform duration-300 group-hover:rotate-45",
          size === "lg" ? "size-12" : "size-9",
        )}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpRight className={size === "lg" ? "size-5" : "size-4"} />}
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={classes}>
      {content}
    </button>
  );
}
