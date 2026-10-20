import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { BUCKET_CERTIFICATES, issueCertificatePdf } from "@/lib/workspace/pipeline";

export const maxDuration = 60;

/** The licence-record PDF, for the brand or creator on the project (public visitors use /verify). */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await apiSession();
  if ("error" in auth) return auth.error;
  const code = (await params).code.toUpperCase();
  if (!/^CRT-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // RLS: only the two parties (and admins) can read the certificate row
  const db = await getServerClient();
  const { data: cert } = await db.from("ip_certificates").select("certificate_id, pdf_path").eq("certificate_id", code).maybeSingle();
  if (!cert) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const admin = getAdminClient();
  let pdf: Uint8Array | null = null;
  if (cert.pdf_path) {
    const { data } = await admin.storage.from(BUCKET_CERTIFICATES).download(cert.pdf_path);
    if (data) pdf = new Uint8Array(await data.arrayBuffer());
  }
  if (!pdf) pdf = (await issueCertificatePdf(admin, code, new URL(request.url).origin)).pdf;

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${code}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
