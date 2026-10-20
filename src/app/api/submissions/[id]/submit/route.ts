import { after, NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGemini } from "@/lib/ai/gemini";
import { submissionDetailsSchema } from "@/lib/validation/workspace";
import { runSubmissionReview } from "@/lib/workspace/pipeline";

// The AI review runs after the response (background job) within this budget.
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Saves the creator's notes + declaration, submits the version (validated RPC), then queues the AI review. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["creator"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Submission not found." }, { status: 404 });

  const parsed = submissionDetailsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form" }, { status: 400 });

  // Everything below runs as the creator: RLS + the RPC enforce ownership, draft status and deadlines.
  const db = await getServerClient();
  const { data: updated, error: saveError } = await db.from("submissions").update(parsed.data).eq("id", id).select("id");
  if (saveError) return NextResponse.json({ error: saveError.message }, { status: 400 });
  if (!updated?.length) return NextResponse.json({ error: "Submission not found or already submitted." }, { status: 404 });

  const { error } = await db.rpc("submit_submission", { p_submission: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  after(async () => {
    await runSubmissionReview(getAdminClient(), id, getGemini());
  });
  return NextResponse.json({ ok: true, review: "queued" });
}
