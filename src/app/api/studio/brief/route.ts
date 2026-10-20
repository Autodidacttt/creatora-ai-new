import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getLookups } from "@/services/lookups";
import { rateLimited } from "@/lib/rate-limit";
import { generateStudioBrief, StudioAIUnavailable } from "@/lib/ai/studio";
import { studioBriefRequestSchema } from "@/lib/validation/workspace";

export const maxDuration = 60;

/** Campaign Studio step 2: the structured, Zod-validated brief (whole brief or one section). Brand only. */
export async function POST(request: Request) {
  const auth = await apiSession(["brand"]);
  if ("error" in auth) return auth.error;
  const parsed = studioBriefRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if (rateLimited(`studio-brief:${auth.session.profile.id}`, 10)) {
    return NextResponse.json({ error: "Too many requests — wait a minute and try again." }, { status: 429 });
  }

  try {
    const lookups = await getLookups(await getServerClient());
    const { brief, model } = await generateStudioBrief({
      idea: parsed.data.idea, linkSummary: parsed.data.link_summary, section: parsed.data.section, current: parsed.data.current,
    }, lookups);
    return NextResponse.json({ brief, model });
  } catch (err) {
    if (err instanceof StudioAIUnavailable) {
      return NextResponse.json({ error: "AI isn't available right now — fill in the brief manually below.", code: "ai_unavailable" }, { status: 503 });
    }
    console.error("[studio/brief]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The AI couldn't write this brief. Try again, or fill it in manually.", code: "ai_failed" }, { status: 502 });
  }
}
