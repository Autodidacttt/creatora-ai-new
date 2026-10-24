import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";

/** Live platform counts for the landing page (public_stats RPC). Cached briefly at the edge; never hard-coded. */
export async function GET() {
  try {
    const db = await getServerClient();
    const { data, error } = await db.rpc("public_stats");
    if (error || !data) return NextResponse.json({ error: "unavailable" }, { status: 503 });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
