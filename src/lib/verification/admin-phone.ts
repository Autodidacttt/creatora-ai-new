import "server-only";
import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/verification/crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reveals the applicant's verified phone number to a permitted admin (no calling feature); every view is logged. */
export async function revealPhone(kind: "identity" | "company", id: string) {
  const auth = await apiSession(["admin"]);
  if ("error" in auth) return auth.error;
  if (!UUID.test(id) || (kind !== "identity" && kind !== "company")) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const db = await getServerClient();
  const { data, error } = kind === "identity"
    ? await db.rpc("admin_get_identity_verification", { p_id: id })
    : await db.rpc("admin_get_company_verification", { p_id: id });
  if (error || !data) return NextResponse.json({ error: "You don't have permission to view this." }, { status: 403 });
  const userId = (data as { user?: { id?: string } }).user?.id;
  const admin = getAdminClient();
  const { data: phone } = await admin.from("verified_phones").select("phone_cipher").eq("user_id", userId!).maybeSingle();
  if (!phone) return NextResponse.json({ error: "No verified phone on this account." }, { status: 404 });
  await admin.from("audit_logs").insert({
    actor_id: auth.session.profile.id, action: "view_phone", target_type: `${kind}_verification`, target_id: id, meta: {},
  });
  return NextResponse.json({ phone: decrypt(phone.phone_cipher) }, { headers: { "cache-control": "no-store" } });
}
