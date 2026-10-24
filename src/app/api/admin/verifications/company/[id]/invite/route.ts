import { NextResponse } from "next/server";
import { z } from "zod";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { pepperedHash, urlToken } from "@/lib/verification/crypto";
import { invitationEmail, sendEmail } from "@/lib/verification/email";
import { verificationSettings } from "@/lib/verification/settings";
import { INVITE_DAYS } from "@/config/verification";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({
  suggestion_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().max(120).optional().default(""),
  role: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().toLowerCase().email("Enter the contact's business email").max(254),
});

/**
 * Sends the "is this person authorized to represent your company?" invitation: single-use token (only its hash is
 * stored), expires in 7 days. EMAIL_SEND_MODE=demo sends nothing and returns the link for the admin to copy.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["admin"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (rateLimited(`invite:${auth.session.profile.id}`, 10)) return NextResponse.json({ error: "Too many invitations — wait a minute." }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the contact" }, { status: 400 });

  const db = await getServerClient();
  const { data: c, error: denied } = await db.rpc("admin_get_company_verification", { p_id: id });
  if (denied || !c) return NextResponse.json({ error: "You don't have permission to do this." }, { status: 403 });
  const company = c as { company_name: string; applicant_name: string; applicant_role: string };

  const token = urlToken();
  const mode = verificationSettings().emailMode;
  const { data: invitationId, error } = await db.rpc("admin_create_invitation", {
    p_company: id, p_suggestion: (parsed.data.suggestion_id ?? null) as unknown as string, p_name: parsed.data.name, p_role: parsed.data.role,
    p_email: parsed.data.email, p_token_hash: pepperedHash("invite", token), p_mode: mode, p_days: INVITE_DAYS,
  });
  if (error || !invitationId) return NextResponse.json({ error: error?.message ?? "Couldn't create the invitation." }, { status: 400 });

  const link = `${new URL(request.url).origin}/verify-company/${token}`;
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const email = invitationEmail({ company: company.company_name, applicant: company.applicant_name, role: company.applicant_role, link, expiresAt });
  let sent: { mode: "demo" | "live"; sent: boolean };
  try {
    sent = await sendEmail({ to: parsed.data.email, ...email });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't send the email." }, { status: 502 });
  }
  if (!sent.sent) {
    // Demo mode: a notification entry for the admin instead of an email (the link itself is only shown in the UI)
    await getAdminClient().from("notifications").insert({
      user_id: auth.session.profile.id, type: "verification", entity_type: "verification", entity_id: id,
      data: { event: "invitation_demo", company_name: company.company_name, contact_email: parsed.data.email, label: "Demo, email not sent" },
    });
  }
  return NextResponse.json({
    invitation_id: invitationId, mode: sent.mode, expires_at: expiresAt,
    ...(sent.mode === "demo" ? { link, demo_label: "Demo, email not sent", email_preview: email } : {}),
  }, { headers: { "cache-control": "no-store" } });
}
