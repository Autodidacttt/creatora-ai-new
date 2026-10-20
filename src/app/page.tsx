/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, BadgeCheck, Layers, Search, ShieldCheck, Wand2, Workflow } from "lucide-react";
import type { CreatorCard } from "@/types/app";
import { getSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/layout/top-bar";
import { PillCTA } from "@/components/ui/pill-cta";
import { LineArt } from "@/components/layout/atmosphere";
import { Counter } from "@/components/ui/counter";
import { buttonVariants } from "@/components/ui/button-variants";

export const dynamic = "force-dynamic";

async function loadLanding() {
  try {
    const db = await getServerClient();
    const [stats, creators] = await Promise.all([
      db.rpc("public_stats"),
      db.rpc("search_creators", { p_sort: "followers", p_limit: 6 }),
    ]);
    return {
      stats: (stats.data as Record<string, number> | null) ?? null,
      creators: (creators.data ?? []).map((r) => r.creator as unknown as CreatorCard),
    };
  } catch {
    return { stats: null, creators: [] as CreatorCard[] };
  }
}

export default async function Landing() {
  if (await getSession()) redirect("/home");
  const { stats, creators } = await loadLanding();
  const tiles = creators.flatMap((c) => c.preview.slice(0, 1).map((p) => ({ ...p, creator: c }))).filter((t) => t.url).slice(0, 5);

  return (
    <div className="mx-auto max-w-7xl px-3 py-4 sm:px-5">
      <div className="glass relative overflow-hidden rounded-[2.5rem] p-4 sm:p-8">
        <LineArt className="pointer-events-none absolute -right-24 -top-24 size-[34rem] text-amber-2 opacity-20" />
        <header className="relative flex items-center gap-3">
          <Wordmark className="mr-auto" />
          <Link href="/login" className={buttonVariants({ variant: "ghost" })}>Sign in</Link>
          <Link href="/signup" className={buttonVariants({ variant: "dark" })}>Join free</Link>
        </header>

        <section className="relative mt-10 grid gap-8 lg:mt-16 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <p className="eyebrow">The AI creator marketplace</p>
            <h1 className="display mt-3 text-5xl leading-[0.92] sm:text-7xl">
              Hire the minds<br />behind the <span className="relative inline-block text-amber-2">models<span aria-hidden className="absolute -right-12 top-2 rotate-12 rounded-lg bg-ink px-1.5 py-0.5 text-xs text-bg">✦ AI</span></span>
            </h1>
            <p className="mt-5 max-w-lg text-base text-ink-2 sm:text-lg">
              Portfolios that show the tools, models and workflow behind every piece. Briefs that capture format, style and usage rights.
              Matching that explains itself.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <PillCTA href="/signup" size="lg">Get started</PillCTA>
              <Link href="/login" className={buttonVariants({ variant: "glass", size: "lg" })}>Try a demo account</Link>
            </div>
          </div>

          <div className="relative grid h-[26rem] grid-cols-3 grid-rows-4 gap-3 sm:h-[30rem]">
            {tiles.length === 0 && <div className="col-span-3 row-span-4 rounded-[2rem] bg-gradient-to-br from-amber/50 to-bg-2" />}
            {tiles.map((t, i) => (
              <div key={t.id} className={[
                "group relative overflow-hidden rounded-[1.75rem] shadow-soft",
                i === 0 ? "col-span-2 row-span-2" : i === 1 ? "row-span-3" : i === 2 ? "row-span-2" : i === 3 ? "row-span-2" : "col-span-1 row-span-1",
              ].join(" ")}>
                <img src={t.url!} alt={t.title} className="size-full object-cover transition-transform duration-700 group-hover:scale-105" />
                <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-full bg-black/35 px-2 py-1 text-xs text-white backdrop-blur">
                  {t.creator.avatar_url && <img src={t.creator.avatar_url} alt="" className="size-5 rounded-full object-cover" />}
                  <span className="truncate">{t.creator.display_name}</span>
                  {t.creator.is_verified && <BadgeCheck className="size-3.5 shrink-0 fill-amber text-on-amber" />}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bento row */}
        <section className="relative mt-10 grid gap-4 lg:grid-cols-[1.2fr_1fr_1.2fr]">
          <div className="glass-strong flex flex-col justify-between gap-6 rounded-[2rem] p-6">
            <div>
              <p className="text-sm text-ink-2">Showcase, get discovered and</p>
              <p className="display text-5xl">GET HIRED</p>
            </div>
            <PillCTA href="/signup">I&apos;m a creator</PillCTA>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ["AI creators", stats?.creators ?? 0],
              ["Portfolio pieces", stats?.posts ?? 0],
              ["Open briefs", stats?.active_briefs ?? 0],
              ["AI tools in use", stats?.tools ?? 0],
            ].map(([label, value], i) => (
              <div key={label} className={`notched rounded-[1.75rem] p-4 ${i === 0 ? "bg-amber text-on-amber" : "bg-card shadow-soft"}`}>
                <Counter value={Number(value)} className="display block text-4xl tabular-nums" />
                <span className="text-xs opacity-75">{label}</span>
              </div>
            ))}
          </div>
          <div className="glass-strong flex flex-col justify-between gap-6 rounded-[2rem] p-6">
            <div>
              <p className="text-sm text-ink-2">Brief it in a sentence and</p>
              <p className="display text-5xl">MATCH</p>
            </div>
            <PillCTA href="/signup" tone="dark">I&apos;m a brand</PillCTA>
          </div>
        </section>

        <section className="relative mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { icon: Workflow, title: "Workflow-first portfolios", body: "Every piece lists tools, models and the pipeline used." },
            { icon: Search, title: "Precise discovery", body: "Filter by tool, skill, format, style, language, availability." },
            { icon: Wand2, title: "AI brief builder", body: "One sentence in, a structured brief out — with rights." },
            { icon: Layers, title: "Explainable matching", body: "Every match shows why, factor by factor." },
            { icon: ShieldCheck, title: "Verified signals", body: "Tool, workflow, past work and identity checks." },
          ].map((f) => (
            <div key={f.title} className="rounded-[1.75rem] bg-card/70 p-5">
              <f.icon className="size-5 text-amber-2" />
              <h2 className="mt-3 text-sm font-semibold">{f.title}</h2>
              <p className="mt-1 text-xs text-ink-2">{f.body}</p>
            </div>
          ))}
        </section>

        <footer className="relative mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-xs text-ink-3">
          <span>© {new Date().getFullYear()} Creatora · built for AI creators and the brands who hire them</span>
          <Link href="/signup" className="inline-flex items-center gap-1 font-semibold text-ink">Create your profile <ArrowUpRight className="size-3.5" /></Link>
        </footer>
      </div>
    </div>
  );
}
