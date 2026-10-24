"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import type { CreatorCard } from "@/types/app";
import { PillCTA } from "@/components/ui/pill-cta";
import { Avatar } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button-variants";
import { MagneticButton, SPRING } from "@/components/astral/interactive";
import { useEffects } from "@/components/astral/effects";

// Code-split: the canvas network only loads in the browser, after the hero text has painted.
const ConstellationNetwork = dynamic(
  () => import("@/components/astral/constellation-network").then((m) => m.ConstellationNetwork),
  { ssr: false },
);

// Headline and lede stay fully opaque from the first paint (they are the LCP); only small elements fade in.
const rise = (i: number, fade = true) => ({
  initial: { opacity: fade ? 0 : 1, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { ...SPRING, delay: 0.07 * i },
});

export function Hero({ creators }: { creators: CreatorCard[] }) {
  const { level } = useEffects();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const textY = useTransform(scrollYProgress, [0, 1], ["0%", "28%"]);
  const textFade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const netY = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);
  const parallax = level === "full";
  const faces = creators.filter((c) => c.avatar_url).slice(0, 5);

  return (
    <section ref={ref} aria-labelledby="hero-title" className="relative isolate flex min-h-svh items-center overflow-hidden px-4 pb-24 pt-32 sm:px-6">
      <motion.div aria-hidden style={parallax ? { y: netY } : undefined} className="absolute inset-0 -z-10">
        <ConstellationNetwork />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_45%,transparent,var(--bg)_95%)]" />
      </motion.div>
      <div aria-hidden className="absolute left-1/2 top-[42%] -z-10 size-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(var(--glow-rgb),0.12),transparent_62%)]" />

      <motion.div style={parallax ? { y: textY, opacity: textFade } : undefined} className="mx-auto w-full max-w-4xl text-center">
        <motion.p {...rise(0)} className="eyebrow inline-flex items-center gap-2 rounded-full border border-glass-border bg-glass px-3 py-1.5 backdrop-blur">
          <span aria-hidden className="size-1.5 rounded-full bg-amber shadow-[0_0_10px_var(--glow)]" />
          The AI creator marketplace
        </motion.p>
        <motion.h1 {...rise(1, false)} id="hero-title" className="display mt-6 text-[clamp(2.6rem,7.5vw,5.6rem)] leading-[0.98]">
          Connect your brief to the right <span className="star-text">AI creator</span>.
        </motion.h1>
        <motion.p {...rise(2, false)} className="mx-auto mt-6 max-w-2xl text-base text-ink-2 sm:text-lg">
          Creators show the tools, models and workflow behind every piece. Brands brief in one sentence, get matches that
          explain themselves, then hire, fund and receive files in one place.
        </motion.p>
        <motion.div {...rise(3)} className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <MagneticButton><PillCTA href="/signup" size="lg">Get started</PillCTA></MagneticButton>
          <Link href="/login" className={buttonVariants({ variant: "glass", size: "lg" })}>Try a demo account</Link>
        </motion.div>

        {faces.length > 0 && (
          <motion.div {...rise(4)} className="mt-10 flex items-center justify-center gap-3 text-sm text-ink-2">
            <span className="flex -space-x-2">
              {faces.map((c) => <Avatar key={c.id} src={c.avatar_url} name={c.display_name} size="sm" className="[&>img]:ring-bg" />)}
            </span>
            <span>Portfolios from {faces.slice(0, 2).map((c) => c.display_name.split(" ")[0]).join(", ")} and more</span>
          </motion.div>
        )}
        <p className="mt-6 hidden items-center justify-center gap-4 text-xs text-ink-3 sm:flex" aria-hidden>
          <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-ink-2" /> creators</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rotate-45 bg-amber" /> brands</span>
          <span className="hidden md:inline">· move your cursor to light up connections</span>
        </p>
      </motion.div>

      <a href="#how" className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 rounded-full px-3 py-1 text-xs text-ink-3 hover:text-ink">
        Scroll
        <span aria-hidden className="fx-motion block h-7 w-px origin-top bg-gradient-to-b from-amber to-transparent [animation:scroll-hint_1.8s_ease-in-out_infinite]" />
      </a>
    </section>
  );
}
