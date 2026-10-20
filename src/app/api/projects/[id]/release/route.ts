import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { issueCertificatePdf } from "@/lib/workspace/pipeline";

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Final approval: releases the (test-mode) escrow, completes the project and issues the licence record.
 * The state change happens in the release_escrow RPC as the brand; only the PDF rendering uses the service role.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["brand"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Project not found." }, { status: 404 });

  const db = await getServerClient();
  const { data: code, error } = await db.rpc("release_escrow", { p_project: id });
  if (error || !code) return NextResponse.json({ error: error?.message ?? "Couldn't release payment." }, { status: 400 });

  try {
    await issueCertificatePdf(getAdminClient(), code, new URL(request.url).origin);
    return NextResponse.json({ certificate_id: code, pdf: true });
  } catch (err) {
    // Payment + certificate record are committed; the PDF is regenerated on first download.
    console.error("[projects/release] pdf", err instanceof Error ? err.message : err);
    return NextResponse.json({ certificate_id: code, pdf: false });
  }
}
