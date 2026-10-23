import { after, NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGemini } from "@/lib/ai/gemini";
import { refreshCreatorEmbeddings } from "@/lib/ai/embeddings";
import { rateLimited } from "@/lib/rate-limit";
import { creatorDataToAi } from "@/config/ai-match";

export const maxDuration = 60;

/**
 * Background embedding refresh, pinged after a creator edits their profile or portfolio (database triggers have
 * already queued them). Processes a small batch of stale creators after responding; nothing is returned to the client.
 */
export async function POST() {
  const auth = await apiSession();
  if ("error" in auth) return auth.error;
  const ai = getGemini();
  if (!ai || !creatorDataToAi() || rateLimited(`embed:${auth.session.profile.id}`, 4)) return NextResponse.json({ queued: false });
  after(async () => { await refreshCreatorEmbeddings(getAdminClient(), ai, 10).catch(() => undefined); });
  return NextResponse.json({ queued: true });
}
