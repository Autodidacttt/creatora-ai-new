import { after, NextResponse } from "next/server";
import { z } from "zod";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getGemini } from "@/lib/ai/gemini";
import { embedTexts, refreshCreatorEmbeddings, toVectorLiteral } from "@/lib/ai/embeddings";
import { keywordRequirements, parseIdea, type MatchRequirements } from "@/lib/ai/creator-finder";
import { getLookups } from "@/services/lookups";
import { rateLimited } from "@/lib/rate-limit";
import { AI_MATCH, AI_MATCH_WEIGHTS, creatorDataToAi } from "@/config/ai-match";
import type { Lookups } from "@/types/app";

// Parsing + embedding + ranking, then a background refresh of stale creator embeddings
export const maxDuration = 60;

const body = z.object({
  idea: z.string().trim().min(AI_MATCH.ideaMin, `Describe the idea in at least ${AI_MATCH.ideaMin} characters`).max(AI_MATCH.ideaMax, `Keep it under ${AI_MATCH.ideaMax} characters`),
  campaign_id: z.string().uuid().nullable().optional(),
});

/** Human labels for the parsed requirements (shown as chips, stored with the search for "recent searches"). */
function labelsOf(r: MatchRequirements, l: Lookups) {
  const name = (list: { id: number; name: string }[], id: number | null) => list.find((x) => x.id === id)?.name;
  return [
    name(l.content_types, r.content_type_id), name(l.styles, r.style_id), name(l.categories, r.category_id),
    ...r.tool_ids.map((id) => name(l.ai_tools, id)), ...r.skill_ids.map((id) => name(l.skills, id)),
    ...r.platform_ids.map((id) => name(l.platforms, id)),
  ].filter((x): x is string => !!x);
}

/** Brand: run an AI Creator Finder search. Returns the persisted search; results are read page by page via RPC. */
export async function POST(request: Request) {
  const auth = await apiSession(["brand"]);
  if ("error" in auth) return auth.error;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if (rateLimited(`ai-match:${auth.session.profile.id}`, AI_MATCH.searchesPerMinute)) {
    return NextResponse.json({ error: "Too many searches — wait a minute and try again." }, { status: 429 });
  }
  const { idea, campaign_id } = parsed.data;
  const started = Date.now();
  const db = await getServerClient();
  const admin = getAdminClient();
  const ai = getGemini();
  const lookups = await getLookups(db);

  // a) structured requirements (AI, else literal tag matches)
  let requirements: MatchRequirements;
  let notice: string | null = null;
  try {
    requirements = await parseIdea(idea, lookups);
  } catch {
    requirements = keywordRequirements(idea, lookups);
    notice = "The AI couldn't read the idea right now, so matching uses tags and keywords from your text.";
  }

  // b) embed the idea (semantic mode); fall back to tags + keywords if that fails or nothing is indexed yet
  let embedding = "";
  let model: string | null = null;
  // (no creator vectors exist while creator data isn't shared with the AI, so don't embed the idea either)
  if (ai && creatorDataToAi()) {
    try {
      const out = await embedTexts(ai, [`${idea}\n${requirements.summary}`], "RETRIEVAL_QUERY");
      embedding = toVectorLiteral(out.vectors[0]);
      model = out.model;
    } catch {
      embedding = "";
    }
  }
  if (embedding && model) {
    const { count } = await admin.from("creator_embeddings").select("creator_id", { count: "exact", head: true }).eq("model", model).not("embedding", "is", null);
    if (!count) embedding = "";
  }
  const mode = embedding ? "semantic" : "tags";
  if (mode === "tags") notice ??= "Semantic matching isn't available right now — ranked by tags and keywords instead.";

  // c) persist the search (RLS: the brand's own; the database rate-limits per brand) and rank ALL creators in SQL
  const { data: searchId, error } = await db.rpc("create_ai_match_search", {
    p_idea: idea, p_requirements: { ...requirements, labels: labelsOf(requirements, lookups) }, p_mode: mode,
    // nullable in SQL (no notice / no embedding model in tags mode)
    p_notice: notice as unknown as string, p_model: model as unknown as string, p_campaign: campaign_id ?? undefined,
  });
  if (error) {
    const limited = /Too many AI searches/.test(error.message);
    return NextResponse.json({ error: error.message }, { status: limited ? 429 : 400 });
  }
  const { data: total, error: rankError } = await db.rpc("run_ai_match", { p_search: searchId, p_query_embedding: embedding, p_weights: AI_MATCH_WEIGHTS, p_keep: AI_MATCH.keep });
  await admin.from("ai_job_logs").insert({
    job: "ai_match", status: rankError ? "failed" : "done", duration_ms: Date.now() - started,
    message: `search ${searchId} · mode ${mode}${rankError ? ` · ${rankError.message.slice(0, 200)}` : ` · ${total} ranked`}`,
  });
  if (rankError) return NextResponse.json({ error: "Ranking failed — try again." }, { status: 502 });

  // Keep creator vectors fresh without slowing this response
  if (ai && creatorDataToAi()) after(async () => { await refreshCreatorEmbeddings(admin, ai, AI_MATCH.refreshBatch).catch(() => undefined); });

  return NextResponse.json({ search_id: searchId, mode, notice, total, labels: labelsOf(requirements, lookups), summary: requirements.summary });
}
