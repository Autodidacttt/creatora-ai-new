import { redirect } from "next/navigation";
import type { CreatorCard } from "@/types/app";
import { getSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { SmoothScroll, ScrollProgress } from "@/components/astral/interactive";
import { LandingNav } from "@/components/landing/landing-nav";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { FeatureChapters } from "@/components/landing/feature-chapters";
import { MatchConstellation } from "@/components/landing/match-constellation";
import { TrustSection } from "@/components/landing/trust";
import { LiveStats, type PublicStats } from "@/components/landing/live-stats";
import { FinalCta } from "@/components/landing/final-cta";

export const dynamic = "force-dynamic";

/** Real counts (public_stats) and the most-followed creators (search_creators). Either may fail: sections fall back gracefully. */
async function loadLanding() {
  try {
    const db = await getServerClient();
    const [stats, creators] = await Promise.all([
      db.rpc("public_stats"),
      db.rpc("search_creators", { p_sort: "followers", p_limit: 8 }),
    ]);
    return {
      stats: stats.error ? null : ((stats.data as PublicStats | null) ?? null),
      creators: (creators.data ?? []).map((r) => r.creator as unknown as CreatorCard),
    };
  } catch {
    return { stats: null, creators: [] as CreatorCard[] };
  }
}

export default async function Landing() {
  if (await getSession()) redirect("/home");
  const { stats, creators } = await loadLanding();

  return (
    <>
      <SmoothScroll />
      <ScrollProgress />
      <LandingNav />
      <main id="main">
        <Hero creators={creators} />
        <HowItWorks />
        <FeatureChapters creators={creators} stats={stats} />
        <MatchConstellation creators={creators} />
        <TrustSection />
        <LiveStats stats={stats} />
        <FinalCta />
      </main>
    </>
  );
}
