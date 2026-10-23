import { NextResponse } from "next/server";
import { z } from "zod";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { explainMatch, FinderUnavailable } from "@/lib/ai/creator-finder";
import { rateLimited } from "@/lib/rate-limit";
import { AI_MATCH, creatorDataToAi } from "@/config/ai-match";

export const maxDuration = 45;

const body = z.object({ creator_id: z.string().uuid() });

/**
 * "Why this creator?" — generated only when asked, from that creator's real evidence, then cached per
 * (search, creator) so repeated clicks never call the AI again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ searchId: string }> }) {
  const auth = await apiSession(["brand"]);
  if ("error" in auth) return auth.error;
  const { searchId } = await params;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(searchId).success || !parsed.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const creatorId = parsed.data.creator_id;
  const db = await getServerClient();

  // Cache (RLS: only the search owner can read it)
  const { data: cached } = await db.from("ai_match_reasons").select("reasons, gaps").eq("search_id", searchId).eq("creator_id", creatorId).maybeSingle();
  if (cached) return NextResponse.json({ ...cached, cached: true });
  // Creator data isn't shared with the AI: answer at once (no evidence read, no AI call, nothing logged)
  if (!creatorDataToAi()) {
    return NextResponse.json({ error: "AI explanations are switched off — the score breakdown shows what matched.", disabled: true }, { status: 503 });
  }

  if (rateLimited(`ai-reason:${auth.session.profile.id}`, AI_MATCH.reasonsPerMinute)) {
    return NextResponse.json({ error: "Too many requests — wait a minute and try again." }, { status: 429 });
  }
  // Evidence (owner-checked in SQL); null = not your search or not in its results
  const { data: evidence, error } = await db.rpc("ai_match_evidence", { p_search: searchId, p_creator: creatorId });
  if (error || !evidence) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = getAdminClient();
  const started = Date.now();
  try {
    const out = await explainMatch(evidence);
    await admin.from("ai_match_reasons").upsert(
      { search_id: searchId, creator_id: creatorId, reasons: out.reasons, gaps: out.gaps, model: out.model },
      { onConflict: "search_id,creator_id", ignoreDuplicates: true },
    );
    await admin.from("ai_job_logs").insert({ job: "ai_match_reason", status: "done", duration_ms: Date.now() - started, message: `search ${searchId} · creator ${creatorId}` });
    return NextResponse.json({ reasons: out.reasons, gaps: out.gaps, cached: false });
  } catch (err) {
    await admin.from("ai_job_logs").insert({ job: "ai_match_reason", status: "failed", duration_ms: Date.now() - started, message: String((err as Error)?.message ?? err).slice(0, 300) });
    if (err instanceof FinderUnavailable) return NextResponse.json({ error: "AI explanations aren't available right now." }, { status: 503 });
    return NextResponse.json({ error: "Couldn't explain this match right now — try again." }, { status: 502 });
  }
}
