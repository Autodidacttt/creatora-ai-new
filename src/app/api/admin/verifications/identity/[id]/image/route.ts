import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { BUCKET_IDENTITY } from "@/lib/verification/identity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ID image, for an admin with the matching permission only: 60-second signed URL, every view audit-logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["admin"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  // Permission check in the database (verify_creators / verify_brands, by kind)
  const { error: denied } = await (await getServerClient()).rpc("admin_get_identity_verification", { p_id: id });
  if (denied) return NextResponse.json({ error: "You don't have permission to view this document." }, { status: 403 });

  const admin = getAdminClient();
  const { data: v } = await admin.from("identity_verifications").select("id_image_path, image_deleted_at").eq("id", id).single();
  if (!v?.id_image_path) return NextResponse.json({ error: "The ID image was deleted under the retention policy." }, { status: 410 });
  const { data, error } = await admin.storage.from(BUCKET_IDENTITY).createSignedUrl(v.id_image_path, 60);
  if (error || !data) return NextResponse.json({ error: "Couldn't open the document." }, { status: 500 });
  await admin.from("audit_logs").insert({
    actor_id: auth.session.profile.id, action: "view_id_image", target_type: "identity_verification", target_id: id, meta: {},
  });
  return NextResponse.json({ url: data.signedUrl, expires_in: 60 }, { headers: { "cache-control": "no-store" } });
}
