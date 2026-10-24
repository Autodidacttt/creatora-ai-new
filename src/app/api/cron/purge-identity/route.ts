import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { purgeExpiredIdImages } from "@/lib/verification/identity";

/**
 * Deletes ID images ID_RETENTION_DAYS after the decision. Runs on a schedule when CRON_SECRET is configured
 * (Vercel Cron sends it as a Bearer token); the same purge also runs opportunistically from the app.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const purged = await purgeExpiredIdImages(getAdminClient(), true);
  return NextResponse.json({ purged });
}
