// AI Creator Finder (brands). Searching and "why" reasons go through API routes (Gemini + embeddings are server-only);
// results, recent searches and saves are read/written with the user's client (RLS: own searches only).
import type { CreatorCard } from "@/types/app";
import { as, type DB, unwrap } from "./_db";
import { AI_MATCH } from "@/config/ai-match";

export interface AiSearchMeta {
  search_id: string;
  mode: "semantic" | "tags";
  notice: string | null;
  total: number;
  labels: string[];
  summary: string;
}

export interface AiMatchBreakdown {
  semantic?: number; tools?: number; skills?: number; style?: number; content_type?: number; specialization?: number;
  experience?: number; availability?: number; keywords?: number;
  matched_tools?: string[]; matched_skills?: string[];
}

export interface AiMatchResult {
  rank: number;
  score: number;
  breakdown: AiMatchBreakdown;
  saved: boolean;
  creator: CreatorCard;
}

export interface AiRecentSearch {
  id: string;
  idea: string;
  mode: "semantic" | "tags";
  notice: string | null;
  result_count: number;
  created_at: string;
  requirements: { labels?: string[]; summary?: string };
}

/** "Why this creator?" is switched off (creator data isn't shared with the AI), so there's nothing to retry. */
export class AiExplanationsOff extends Error {}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; disabled?: boolean };
  if (!res.ok) throw json.disabled ? new AiExplanationsOff(json.error) : new Error(json.error ?? "Request failed");
  return json as T;
}

export const runAiSearch = (idea: string, campaignId?: string | null) => post<AiSearchMeta>("/api/ai/match", { idea, campaign_id: campaignId ?? null });

export async function getAiResults(db: DB, searchId: string, page = 0, size: number = AI_MATCH.pageSize) {
  const rows = unwrap(await db.rpc("get_ai_match_results", { p_search: searchId, p_limit: size, p_offset: page * size }));
  const items = rows.map((r) => ({
    rank: r.rank, score: r.score, saved: r.saved,
    breakdown: as<AiMatchBreakdown>(r.breakdown), creator: as<CreatorCard>(r.creator),
  })) as AiMatchResult[];
  const total = Number(rows[0]?.total_count ?? 0);
  return { items, total, nextPage: (page + 1) * size < total ? page + 1 : null };
}

export async function getRecentAiSearches(db: DB, limit = 6): Promise<AiRecentSearch[]> {
  const rows = unwrap(await db.from("ai_match_searches").select("id, idea, mode, notice, result_count, created_at, requirements")
    .order("created_at", { ascending: false }).limit(limit));
  return rows as unknown as AiRecentSearch[];
}

export async function setAiResultSaved(db: DB, searchId: string, creatorId: string, saved: boolean) {
  unwrap(await db.rpc("set_ai_match_saved", { p_search: searchId, p_creator: creatorId, p_saved: saved }));
}

export const explainAiMatch = (searchId: string, creatorId: string) =>
  post<{ reasons: string[]; gaps: string[]; cached: boolean }>(`/api/ai/match/${searchId}/reason`, { creator_id: creatorId });

/** Fire-and-forget: refresh the signed-in creator's search embedding after a profile / portfolio change. */
export function pingEmbeddingRefresh() {
  if (typeof window === "undefined") return;
  void fetch("/api/ai/embeddings", { method: "POST", keepalive: true }).catch(() => undefined);
}
