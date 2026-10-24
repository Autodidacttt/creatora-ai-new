"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { Counter } from "@/components/ui/counter";
import { Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { ScrollSection } from "@/components/astral/scroll-section";
import { GlowCard, ScrollReveal } from "@/components/astral/interactive";
import { ConstellationMark } from "@/components/astral/ornaments";

/** Shape of the public_stats() RPC — live counts, never hard-coded. */
export interface PublicStats { creators: number; brands: number; posts: number; active_briefs: number; tools: number }

const TILES: { key: keyof PublicStats; label: string }[] = [
  { key: "creators", label: "AI creators" },
  { key: "brands", label: "Brands hiring" },
  { key: "posts", label: "Portfolio pieces" },
  { key: "active_briefs", label: "Open briefs" },
  { key: "tools", label: "AI tools in use" },
];

/**
 * Live counters. Server-rendered when the RPC succeeded; otherwise one client retry with a shimmering skeleton,
 * and finally a quiet fallback with a manual retry.
 */
export function LiveStats({ stats: initial }: { stats: PublicStats | null }) {
  const [stats, setStats] = useState(initial);
  const [state, setState] = useState<"idle" | "loading" | "failed">(initial ? "idle" : "loading");

  const load = async () => {
    setState("loading");
    const { data, error } = await getBrowserClient().rpc("public_stats");
    if (error || !data) return setState("failed");
    setStats(data as unknown as PublicStats);
    setState("idle");
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one retry when the server render had no data
    if (!initial) void load();
  }, [initial]);

  return (
    <ScrollSection
      id="stats"
      eyebrow="Live from the database"
      title={<>The sky so far, <span className="star-text">counted live</span>.</>}
      lede="These numbers come straight from Creatora's database each time this page loads."
    >
      <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {TILES.map((t, i) => (
          <ScrollReveal key={t.key} delay={0.05 * i} className={i === 0 ? "col-span-2 lg:col-span-1" : undefined}>
            <GlowCard className="h-full p-5 sm:p-6">
              {stats ? (
                <Counter value={Number(stats[t.key] ?? 0)} format="plain" className="display block text-4xl tabular-nums sm:text-5xl" />
              ) : state === "loading" ? (
                <Skeleton className="h-11 w-20 sm:h-12" />
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
    </ScrollSection>
  );
}
