import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { adminActionSchema } from "@/lib/validation/schemas";

/** Privileged moderation actions. Role is re-checked here; writes use the service role and are audit-logged. */
export async function POST(request: Request) {
  const auth = await apiSession(["admin"]);
  if ("error" in auth) return auth.error;
  const actorId = auth.session.profile.id;

  const parsed = adminActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid admin action" }, { status: 400 });
  const action = parsed.data;
  const db = getAdminClient();

  const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
  let target: { type: string; id: string };
  let meta: Record<string, unknown> = {};

  switch (action.action) {
    case "set_verified": {
      const { error } = await db.from("profiles").update({ is_verified: action.value }).eq("id", action.user_id);
      if (error) return fail(error.message);
      target = { type: "profile", id: action.user_id };
      meta = { value: action.value };
      break;
    }
    case "set_suspended": {
      if (action.user_id === actorId) return fail("You can't suspend yourself.");
      const { error } = await db.from("profiles").update({ is_suspended: action.value }).eq("id", action.user_id);
      if (error) return fail(error.message);
      target = { type: "profile", id: action.user_id };
      meta = { value: action.value };
      break;
    }
    case "review_verification": {
      const { data, error } = await db
        .from("verifications")
        .update({ status: action.status, reviewed_by: actorId, reviewed_at: new Date().toISOString(), review_notes: action.notes ?? null })
        .eq("id", action.verification_id)
        .select("creator_id, type")
        .single();
      if (error) return fail(error.message);
      // An approved identity check marks the creator as verified overall
      if (action.status === "approved" && data.type === "identity") {
        await db.from("profiles").update({ is_verified: true }).eq("id", data.creator_id);
      }
      target = { type: "verification", id: action.verification_id };
      meta = { status: action.status };
      break;
    }
    case "set_post_removed": {
      const { error } = await db.from("posts").update({ is_removed: action.value }).eq("id", action.post_id);
      if (error) return fail(error.message);
      target = { type: "post", id: action.post_id };
      meta = { removed: action.value };
      break;
    }
    case "resolve_report": {
      const { error } = await db
        .from("reports")
        .update({ status: action.status, resolved_by: actorId, resolved_at: new Date().toISOString() })
        .eq("id", action.report_id);
      if (error) return fail(error.message);
      target = { type: "report", id: action.report_id };
      meta = { status: action.status };
      break;
    }
  }

  await db.from("audit_logs").insert({
    actor_id: actorId, action: action.action, target_type: target.type, target_id: target.id, meta: meta as never,
  });
  return NextResponse.json({ ok: true });
}
