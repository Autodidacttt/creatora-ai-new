import { after, NextResponse } from "next/server";
import { z } from "zod";
import { apiSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { normalizeIdNumber, pepperedHash } from "@/lib/verification/crypto";
import { BUCKET_IDENTITY, runMockIdentityCheck } from "@/lib/verification/identity";
import { ID_IMAGE, ID_TYPES } from "@/config/verification";

export const maxDuration = 30;

const fields = z.object({
  full_name: z.string().trim().min(2, "Enter your full name as on the ID").max(120),
  id_type: z.enum(ID_TYPES.map((t) => t.value) as [string, ...string[]]),
  id_number: z.string().trim().min(4, "Enter the ID number").max(40).refine((v) => normalizeIdNumber(v).length >= 4, "Enter the ID number"),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth").refine((v) => {
    const d = new Date(v); return !Number.isNaN(d.getTime()) && d < new Date() && d > new Date("1900-01-01");
  }, "Enter a valid date of birth"),
  consent: z.literal("true", { message: "Please accept the privacy notice" }),
});
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
// Magic bytes, so a renamed file can't slip in
const sniff = (b: Uint8Array) =>
  b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
  : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "image/png"
  : b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 ? "image/webp" : null;

/** ID verification (creators and individual recruiters). Never logs the submitted values. */
export async function POST(request: Request) {
  const auth = await apiSession(["creator", "brand"]);
  if ("error" in auth) return auth.error;
  const me = auth.session.profile;
  if (rateLimited(`id-submit:${me.id}`, 5)) return fail("Too many submissions — wait a minute.", 429);

  const form = await request.formData().catch(() => null);
  if (!form) return fail("Send the form as multipart/form-data.");
  const parsed = fields.safeParse(Object.fromEntries(["full_name", "id_type", "id_number", "dob", "consent"].map((k) => [k, form.get(k) ?? undefined])));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form");
  const file = form.get("id_image");
  if (!(file instanceof File) || file.size === 0) return fail("Upload a photo of your government ID.");
  if (file.size > ID_IMAGE.maxBytes) return fail("The image must be 5 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime || !(ID_IMAGE.types as readonly string[]).includes(mime)) return fail("Upload a JPEG, PNG or WebP image.");

  const admin = getAdminClient();
  const kind = me.role === "creator" ? "creator" : "recruiter";
  const path = `${me.id}/${crypto.randomUUID()}.${mime.split("/")[1]}`;
  const up = await admin.storage.from(BUCKET_IDENTITY).upload(path, bytes, { contentType: mime, upsert: false });
  if (up.error) return fail("Couldn't store the image — try again.", 500);

  const idNorm = normalizeIdNumber(parsed.data.id_number);
  const { data: id, error } = await admin.rpc("verification_submit_identity", {
    p_user: me.id, p_kind: kind, p_full_name: parsed.data.full_name, p_id_type: parsed.data.id_type,
    p_id_hash: pepperedHash("id_number", idNorm), p_last4: idNorm.slice(-4), p_dob: parsed.data.dob,
    p_image_path: path, p_consent: true,
  });
  if (error || !id) {
    // Don't leave the image behind; if that fails, record it (object id only) — the orphan report lists it
    const cleanup = await admin.storage.from(BUCKET_IDENTITY).remove([path]);
    if (cleanup.error || !cleanup.data?.some((o) => o.name === path)) {
      console.error("identity upload cleanup failed", cleanup.error?.name ?? "not removed");
      await admin.from("audit_logs").insert({
        actor_id: me.id, action: "identity_upload_cleanup_failed", target_type: "storage_object", target_id: up.data.id ?? "unknown", meta: { bucket: BUCKET_IDENTITY },
      });
    }
    if (error?.code === "23505") return fail("You already have a verification under review.", 409);
    return fail(error?.message ?? "Couldn't submit the verification.", error?.code === "42501" ? 403 : 400);
  }

  // Advisory mock government-ID check (simulated), stored for the admin; the admin decides
  const origin = new URL(request.url).origin;
  const input = { name: parsed.data.full_name, id_number: parsed.data.id_number, dob: parsed.data.dob };
  after(async () => {
    const check = await runMockIdentityCheck(origin, input);
    await admin.rpc("verification_set_mock_check", { p_id: id as string, p_check: check });
  });
  return NextResponse.json({ id, status: "pending" });
}
