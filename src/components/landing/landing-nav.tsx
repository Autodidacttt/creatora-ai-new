"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/layout/top-bar";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import { SECTIONS } from "./sections";

/** Landing header: wordmark, section anchors (desktop) and the existing Sign in / Join free entry points. */
export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      setScrolled(window.scrollY > 24);
      // the section crossing the viewport's middle line is "current"
      const mid = window.innerHeight * 0.45;
      const hit = SECTIONS.find((s) => {
        const r = document.getElementById(s.id)?.getBoundingClientRect();
        return r && r.top <= mid && r.bottom > mid;
      });
      setActive(hit?.id ?? null);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-3 sm:px-5">
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center gap-2 rounded-full px-3 py-2 transition-all duration-500 sm:gap-3",
          scrolled ? "glass-strong" : "border border-transparent",
        )}
      >
        <Link href="/" className="mr-auto rounded-full" aria-label="Creatora home"><Wordmark /></Link>
        <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active === s.id ? "location" : undefined}
              className={cn(
                "relative rounded-full px-3 py-1.5 text-sm transition-colors hover:text-ink",
                active === s.id ? "text-ink" : "text-ink-2",
              )}
            >
              {s.label}
              {active === s.id && <span aria-hidden className="absolute inset-x-3 -bottom-0.5 h-px bg-gradient-to-r from-transparent via-amber to-transparent" />}
            </a>
          ))}
        </nav>
        <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Sign in</Link>
        <Link href="/signup" className={buttonVariants({ variant: "dark" })}>Join free</Link>
      </div>
    </header>
  );
}
