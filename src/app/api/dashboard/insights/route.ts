import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { buildInsights, type Evidence } from "@/lib/ai/insights";

export const maxDuration = 60;

// One refresh per creator every 30s (per instance) — the result is cached in the database anyway.
const last = new Map<string, number>();

/** Regenerates the creator's AI insights from aggregated evidence and caches them. Creator-only. */
export async function POST() {
  const auth = await apiSession(["creator"]);
  if ("error" in auth) return auth.error;
  const creatorId = auth.session.profile.id;
  if (Date.now() - (last.get(creatorId) ?? 0) < 30_000) {
    return NextResponse.json({ error: "Insights were just refreshed — try again in a few seconds." }, { status: 429 });
  }
  last.set(creatorId, Date.now());

  // Evidence is computed in SQL as the signed-in user (dashboard_assert enforces ownership)
  const db = await getServerClient();
  const { data, error } = await db.rpc("dashboard_ai_evidence", { p_creator: creatorId });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Couldn't gather your stats" }, { status: 500 });
  const evidence = data as unknown as Evidence;

  const { insights, model } = await buildInsights(evidence);
  const generated_at = new Date().toISOString();
  const { error: saveError } = await getAdminClient().from("creator_ai_insights").upsert({
    creator_id: creatorId, evidence: data, insights: insights as never, model, generated_at,
  });
  if (saveError) console.warn("[dashboard/insights] cache write failed:", saveError.message);

  return NextResponse.json({ insights: { ...insights, generated_at, model } });
}
