"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Wordmark } from "@/components/layout/top-bar";
import { PillCTA } from "@/components/ui/pill-cta";
import { buttonVariants } from "@/components/ui/button-variants";
import { GlowButton, ScrollReveal } from "@/components/cosmic/interactive";
import { OrbitLines } from "@/components/cosmic/ornaments";
import { useScrolled } from "@/components/cosmic/use-scrolled";
import { cn } from "@/lib/utils";

/** Landing header (from the reference): wordmark, Sign in, Join free. Transparent over the story; glass once scrolled. */
export function LandingNav() {
  const scrolled = useScrolled(24);
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5">
      <a href="#join" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-amber focus:px-4 focus:py-2 focus:text-on-amber">
        Skip to sign up
      </a>
      <div className={cn(
        "mx-auto flex max-w-[1100px] items-center gap-2 rounded-full px-3 py-2 transition-[background-color,box-shadow,backdrop-filter] duration-500 sm:gap-4",
        scrolled ? "glass-strong glass-surface" : "border border-transparent",
      )}>
        <Link href="/" className="mr-auto rounded-full" aria-label="Creatora home"><Wordmark /></Link>
        <Link href="/login" className={buttonVariants({ variant: "ghost", size: "md" })}>Sign in</Link>
        <Link href="/signup" className={cn(buttonVariants({ variant: "dark", size: "md" }), "text-on-amber")}>Join free</Link>
      </div>
    </header>
  );
}

/** Join block + footer after the story. Wired to the real sign-up, sign-in and demo (sign-in page shortcuts) routes. */
export function LandingFooter() {
  return (
    <>
      <section id="join" aria-labelledby="join-title" className="relative scroll-mt-20 overflow-hidden px-4 py-24 sm:px-6 sm:py-32">
        <OrbitLines className="pointer-events-none absolute left-1/2 top-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2 text-ink opacity-[0.07]" />
        <div aria-hidden className="absolute left-1/2 top-1/2 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(var(--glow-rgb),0.12),transparent_65%)]" />
        <ScrollReveal className="relative mx-auto max-w-2xl text-center">
          <h2 id="join-title" className="display text-[clamp(2.2rem,5.5vw,3.8rem)] leading-[1.04]">Join as a creator or a brand.</h2>
          <p className="mx-auto mt-4 max-w-lg text-ink-2 sm:text-lg">Free to start. Or try a demo account from the sign-in page.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <GlowButton><PillCTA href="/signup" size="lg">Create your account</PillCTA></GlowButton>
            <Link href="/login" className={buttonVariants({ variant: "glass", size: "lg" })}>Sign in or try a demo</Link>
          </div>
        </ScrollReveal>
      </section>
      <footer className="border-t border-line px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-4 text-sm text-ink-3">
          <Wordmark className="mr-auto text-ink" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="#story" className="hover:text-ink">The story</a>
            <a href="#stats" className="hover:text-ink">Live stats</a>
            <Link href="/login" className="hover:text-ink">Sign in</Link>
            <Link href="/signup" className="inline-flex items-center gap-1 font-semibold text-ink">Join free <ArrowUpRight className="size-3.5" /></Link>
          </nav>
          <p className="w-full text-xs">© {new Date().getFullYear()} Creatora · built for AI creators and the brands who hire them</p>
        </div>
      </footer>
    </>
  );
}
