import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PillCTA } from "@/components/ui/pill-cta";
import { buttonVariants } from "@/components/ui/button-variants";
import { Wordmark } from "@/components/layout/top-bar";
import { MagneticButton, ScrollReveal } from "@/components/astral/interactive";
import { OrbitLines } from "@/components/astral/ornaments";
import { SECTIONS } from "./sections";

export function FinalCta() {
  return (
    <>
      <section aria-labelledby="cta-title" className="relative overflow-hidden px-4 py-28 sm:px-6 sm:py-36">
        <OrbitLines className="pointer-events-none absolute left-1/2 top-1/2 size-[46rem] -translate-x-1/2 -translate-y-1/2 text-ink opacity-[0.08]" />
        <div aria-hidden className="absolute left-1/2 top-1/2 size-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(var(--glow-rgb),0.14),transparent_65%)]" />
        <ScrollReveal className="relative mx-auto max-w-3xl text-center">
          <h2 id="cta-title" className="display text-[clamp(2.4rem,6vw,4.4rem)] leading-[1.02]">
            Bring your brief. <span className="star-text">Find your creator.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-ink-2 sm:text-lg">
            Join as a creator to get discovered, or as a brand to brief, match and hire. It&apos;s free to start.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <MagneticButton><PillCTA href="/signup" size="lg">I&apos;m a creator</PillCTA></MagneticButton>
            <MagneticButton><PillCTA href="/signup" size="lg" tone="dark">I&apos;m a brand</PillCTA></MagneticButton>
          </div>
          <Link href="/login" className={buttonVariants({ variant: "link", className: "mt-6 text-ink-2" })}>Or try a demo account</Link>
        </ScrollReveal>
      </section>

      <footer className="border-t border-line px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-4 text-sm text-ink-3">
          <Wordmark className="mr-auto text-ink" />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="hover:text-ink">{s.label}</a>)}
            <Link href="/login" className="hover:text-ink">Sign in</Link>
          </nav>
          <p className="w-full text-xs sm:w-auto">© {new Date().getFullYear()} Creatora · built for AI creators and the brands who hire them</p>
          <Link href="/signup" className="inline-flex items-center gap-1 text-xs font-semibold text-ink">Create your profile <ArrowUpRight className="size-3.5" /></Link>
        </div>
      </footer>
    </>
  );
}
