import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { BUCKET_ORIGINALS } from "@/lib/workspace/pipeline";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Signed URLs are single-purpose and expire fast, so a leaked link stops working almost at once. */
const EXPIRES_IN = 60;

const deny = (error: string, status = 403) => NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });

/**
 * The ONLY way to a clean (un-watermarked) original. Clients have no read access to the originals bucket.
 * - The creator can always fetch their own upload.
 * - The brand only when it owns the campaign, the submission is approved AND escrow.status = 'released'.
 * Checked on every request, so any state other than released (refund, dispute, cancellation) keeps it locked.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const auth = await apiSession(["brand", "creator"]);
  if ("error" in auth) return auth.error;
  const { id, fileId } = await params;
  if (!UUID.test(id) || !UUID.test(fileId)) return deny("File not found.", 404);
  const me = auth.session.profile;

  const admin = getAdminClient();
  const { data: file } = await admin.from("submission_files").select("storage_path, file_name, kind").eq("id", fileId).eq("submission_id", id).maybeSingle();
  if (!file || file.kind !== "upload" || !file.storage_path) return deny("File not found.", 404);
  const { data: s } = await admin.from("submissions").select("creator_id, status, project_id, campaign_id").eq("id", id).single();
  const { data: c } = await admin.from("campaigns").select("brand_id").eq("id", s!.campaign_id).single();

  if (s!.creator_id !== me.id) {
    if (c?.brand_id !== me.id) return deny("You don't have access to this file.");
    if (s!.status !== "approved") return deny("Clean files unlock after you approve this version and release the payment.");
    const { data: e } = await admin.from("escrow_payments").select("status").eq("campaign_creator_id", s!.project_id).maybeSingle();
    if (e?.status !== "released") return deny("Clean files unlock after the payment is released.");
  }

  const { data, error } = await admin.storage.from(BUCKET_ORIGINALS).createSignedUrl(file.storage_path, EXPIRES_IN, { download: file.file_name ?? true });
  if (error || !data) return deny("Couldn't prepare the download — try again.", 500);
  return NextResponse.json({ url: data.signedUrl, expires_in: EXPIRES_IN }, { headers: { "cache-control": "no-store" } });
}
