import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { normalizeIdNumber, normalizeName, sha256, sameHash } from "@/lib/verification/crypto";
import { clientIp, mockIdentityApiKey } from "@/lib/verification/settings";

/**
 * MOCK government-ID API — a stand-in for an external identity provider, built as its own service:
 * API-key header, JSON in/out, artificial latency, rate limiting. It only knows ~10 FICTIONAL identities and is
 * never a real government / UIDAI check. It never says which field didn't match.
 */
const body = z.object({ name: z.string().min(2).max(120), id_number: z.string().min(3).max(40), dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function POST(request: Request) {
  const key = request.headers.get("x-api-key") ?? "";
  const expected = mockIdentityApiKey();
  if (!key || !sameHash(sha256(key), sha256(expected))) return NextResponse.json({ error: "invalid_api_key" }, { status: 401 });
  if (rateLimited(`mock-id:${clientIp(request)}`, 30)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 350)));   // behaves like a remote service
  const { data } = await getAdminClient().from("mock_identity_records").select("full_name_norm, dob")
    .eq("id_number_hash", sha256(`creatora-mock-id:${normalizeIdNumber(parsed.data.id_number)}`)).maybeSingle();
  const match = !!data && data.full_name_norm === normalizeName(parsed.data.name) && data.dob === parsed.data.dob;
  return NextResponse.json({
    result: match ? "Identity Verified" : "Identity Not Verified",
    simulated: true,
    notice: "Simulated check, not a government verification",
  }, { headers: { "cache-control": "no-store" } });
}
