import { after, NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGemini } from "@/lib/ai/gemini";
import { rateLimited } from "@/lib/rate-limit";
import { runSubmissionReview } from "@/lib/workspace/pipeline";

export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Brand-only: re-runs the AI review for a submission (retry after a failure). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["brand"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  if (rateLimited(`review-ai:${auth.session.profile.id}`, 6)) {
    return NextResponse.json({ error: "Too many re-runs — wait a minute." }, { status: 429 });
  }

  // Access check as the brand: AI results are only visible to the campaign's brand (RLS)
  const db = await getServerClient();
  const { data: ai } = await db.from("ai_review_results").select("status, updated_at").eq("submission_id", id).maybeSingle();
  if (!ai) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  if (ai.status === "running" && Date.now() - new Date(ai.updated_at).getTime() < 120_000) {
    return NextResponse.json({ error: "The review is already running." }, { status: 409 });
  }

  await getAdminClient().from("ai_review_results").update({ status: "pending", error: null }).eq("submission_id", id);
  after(async () => {
    await runSubmissionReview(getAdminClient(), id, getGemini());
  });
  return NextResponse.json({ ok: true, status: "pending" }, { status: 202 });
}
