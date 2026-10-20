import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getLookups } from "@/services/lookups";
import { briefPromptSchema } from "@/lib/validation/schemas";
import { BriefBuilderUnavailable, buildBrief } from "@/lib/ai/brief-builder";

// Model fallbacks + retries can take a while on a cold, busy API
export const maxDuration = 60;

// Simple per-instance rate limit: 8 generations per user per minute.
const hits = new Map<string, number[]>();
function rateLimited(userId: string) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > 8;
}

export async function POST(request: Request) {
  const auth = await apiSession(["brand", "admin"]);
  if ("error" in auth) return auth.error;

  const parsed = briefPromptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (rateLimited(auth.session.profile.id)) {
    return NextResponse.json({ error: "Too many requests — wait a minute and try again." }, { status: 429 });
  }

  try {
    const lookups = await getLookups(await getServerClient());
    const result = await buildBrief(parsed.data.prompt, lookups);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BriefBuilderUnavailable) {
      return NextResponse.json(
        { error: "The AI brief builder isn't available right now. Fill in the form below manually.", code: "ai_unavailable" },
        { status: 503 },
      );
    }
    console.error("[ai/brief]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "The AI couldn't structure that brief. Try rephrasing, or fill in the form manually.", code: "ai_failed" },
      { status: 502 },
    );
  }
}
