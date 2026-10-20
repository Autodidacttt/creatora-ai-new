import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { receiptPdf } from "@/lib/pdf/documents";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProjectForReceipt {
  id: string;
  campaign: { title: string; brand: { display_name: string; company_name: string | null } };
  creator: { display_name: string; username: string };
  escrow: { status: string; amount: number; currency: string; platform_fee: number; funded_at: string | null; released_at: string | null } | null;
  certificate_id: string | null;
  payments: { event: string; created_at: string; amount: number; currency: string }[];
}

/** Earnings receipt (test mode) for a released payment. Built from data the caller can read (RLS). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["creator", "brand"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const db = await getServerClient();
  const { data, error } = await db.rpc("get_project", { p_project: id });
  const p = data as unknown as ProjectForReceipt | null;
  if (error || !p) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!p.escrow || p.escrow.status !== "released" || !p.escrow.released_at) {
    return NextResponse.json({ error: "A receipt is available once payment is released." }, { status: 409 });
  }

  const pdf = await receiptPdf({
    receipt_id: `RCPT-${p.id.slice(0, 8).toUpperCase()}`,
    campaign_title: p.campaign.title,
    brand: p.campaign.brand.company_name ?? p.campaign.brand.display_name,
    creator: p.creator.display_name,
    creator_username: p.creator.username,
    amount: p.escrow.amount,
    currency: p.escrow.currency,
    platform_fee: p.escrow.platform_fee,
    funded_at: p.escrow.funded_at,
    released_at: p.escrow.released_at,
    certificate_id: p.certificate_id,
    ledger: p.payments.map((e) => ({ event: e.event, created_at: e.created_at, amount: e.amount, currency: e.currency })),
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="receipt-${p.id.slice(0, 8)}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
