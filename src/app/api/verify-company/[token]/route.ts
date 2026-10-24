import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { pepperedHash } from "@/lib/verification/crypto";
import { clientIp } from "@/lib/verification/settings";

const body = z.object({ decision: z.enum(["approved", "rejected"]), comment: z.string().max(1000).optional().default("") });

/** Public (no login): records the company contact's answer. Single use, expiring, rate-limited, server-side only. */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (rateLimited(`invite-respond:${clientIp(request)}`, 10)) return NextResponse.json({ error: "Too many requests — try again in a minute." }, { status: 429 });
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose Approve or Reject." }, { status: 400 });
  const { data, error } = await getAdminClient().rpc("company_invitation_respond", {
    p_token_hash: pepperedHash("invite", token), p_decision: parsed.data.decision, p_comment: parsed.data.comment,
  });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "This link is not valid." : "Couldn't record your answer." }, { status: error.code === "42501" ? 404 : 400 });
  return NextResponse.json({ result: data }, { headers: { "cache-control": "no-store" } });
}
