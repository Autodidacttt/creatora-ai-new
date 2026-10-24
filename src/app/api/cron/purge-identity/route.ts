import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { PurgeQueryError, purgeExpiredIdImages } from "@/lib/verification/identity";
import { sameHash, sha256 } from "@/lib/verification/crypto";

/**
 * Deletes ID images ID_RETENTION_DAYS after the decision. Scheduled daily by Vercel Cron (vercel.json), which sends
 * CRON_SECRET as a Bearer token; the same purge also runs opportunistically from the app. 500 when anything wasn't
 * purged (it's retried on the next run), so a failed run shows up in the cron logs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Constant-time comparison (hashing first makes the lengths equal)
  if (!secret || !sameHash(sha256(request.headers.get("authorization") ?? ""), sha256(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  try {
    const result = await purgeExpiredIdImages(getAdminClient(), { trigger: "cron", force: true });
    return NextResponse.json(result, { status: result.failed ? 500 : 200 });
  } catch (err) {
    if (!(err instanceof PurgeQueryError)) console.error("identity purge (cron) failed", (err as Error)?.name ?? "");
    return NextResponse.json({ error: "The purge couldn't run; it will be retried on the next run." }, { status: 500 });
  }
}
