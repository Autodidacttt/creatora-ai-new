"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Counter } from "@/components/ui/counter";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { ConstellationMark } from "@/components/cosmic/ornaments";
import { GlowCard, ScrollReveal } from "@/components/cosmic/interactive";

/** Shape of /api/public-stats (public_stats RPC) — live counts, never hard-coded. */
export interface PublicStats { creators: number; brands: number; posts: number; active_briefs: number; tools: number }

const TILES: { key: keyof PublicStats; label: string }[] = [
  { key: "creators", label: "AI creators" },
  { key: "brands", label: "Brands hiring" },
  { key: "posts", label: "Portfolio pieces" },
  { key: "active_briefs", label: "Open briefs" },
  { key: "tools", label: "AI tools in use" },
];

/** Live counters after the story: shimmering skeletons while loading, a quiet fallback with retry if the API fails. */
export function LiveStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/public-stats");
      if (!res.ok) throw new Error(String(res.status));
      setStats((await res.json()) as PublicStats);
      setState("ok");
    } catch {
      setState("failed");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of live counts
    void load();
  }, [load]);

  return (
    <section id="stats" aria-labelledby="stats-title" className="relative scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <ScrollReveal className="max-w-2xl">
          <p className="eyebrow flex items-center gap-2"><span aria-hidden className="size-1 rounded-full bg-amber shadow-[0_0_8px_var(--glow)]" />Live from the database</p>
          <h2 id="stats-title" className="display mt-3 text-4xl leading-[1.04] sm:text-5xl">The sky so far, <span className="star-text">counted live</span>.</h2>
          <p className="mt-4 text-base text-ink-2 sm:text-lg">These numbers come straight from Creatora&apos;s database.</p>
        </ScrollReveal>
        <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5" aria-busy={state === "loading"}>
          {TILES.map((t, i) => (
            <ScrollReveal key={t.key} delay={0.05 * i} className={i === 0 ? "col-span-2 lg:col-span-1" : undefined}>
              <GlowCard className="h-full p-5 sm:p-6">
                {stats ? (
                  <Counter value={Number(stats[t.key] ?? 0)} format="plain" className="display block text-4xl tabular-nums sm:text-5xl" />
                ) : state === "loading" ? (
                  <Skeleton className="h-10 w-20 sm:h-12" />
                ) : (
                  <span className="display block text-4xl text-ink-3 sm:text-5xl" aria-label="Unavailable">—</span>
                )}
                <span className="mt-2 block text-sm text-ink-2">{t.label}</span>
              </GlowCard>
            </ScrollReveal>
          ))}
        </div>
        {state === "failed" && (
          <div role="status" className="mt-5 flex flex-wrap items-center gap-3 text-sm text-ink-2">
            <ConstellationMark className="w-10 text-ink-3" />
            Live numbers aren&apos;t available right now.
            <Button size="sm" onClick={() => void load()}><RefreshCw /> Try again</Button>
          </div>
        )}
      </div>
    </section>
  );
}
