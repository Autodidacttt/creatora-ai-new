import type { CreatorCard, RankedCreator } from "@/types/app";
import { as, type DB, unwrap } from "./_db";
import { toPage, type Page } from "./posts";

export interface CreatorFilters {
  q: string;
  skills: number[];
  categories: number[];
  tools: number[];
  contentTypes: number[];
  styles: number[];
  experience: string[];
  availability: string[];
  languages: number[];
  verified: boolean;
  sort: "best" | "newest" | "followers";
}

export const EMPTY_FILTERS: CreatorFilters = {
  q: "", skills: [], categories: [], tools: [], contentTypes: [], styles: [],
  experience: [], availability: [], languages: [], verified: false, sort: "best",
};

export type FilterGroup =
  | "query" | "skills" | "categories" | "tools" | "content_types" | "styles"
  | "experience" | "availability" | "languages" | "verified";

const nums = (v: string | null) => (v ? v.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0) : []);
const strs = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);

/** URL <-> filters, so searches are shareable and survive reloads. */
export function filtersFromParams(params: URLSearchParams): CreatorFilters {
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    skills: nums(params.get("skills")),
    categories: nums(params.get("categories")),
    tools: nums(params.get("tools")),
    contentTypes: nums(params.get("types")),
    styles: nums(params.get("styles")),
    experience: strs(params.get("exp")),
    availability: strs(params.get("avail")),
    languages: nums(params.get("langs")),
    verified: params.get("verified") === "1",
    sort: sort === "newest" || sort === "followers" ? sort : "best",
  };
}

export function filtersToParams(f: CreatorFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.skills.length) p.set("skills", f.skills.join(","));
  if (f.categories.length) p.set("categories", f.categories.join(","));
  if (f.tools.length) p.set("tools", f.tools.join(","));
  if (f.contentTypes.length) p.set("types", f.contentTypes.join(","));
  if (f.styles.length) p.set("styles", f.styles.join(","));
  if (f.experience.length) p.set("exp", f.experience.join(","));
  if (f.availability.length) p.set("avail", f.availability.join(","));
  if (f.languages.length) p.set("langs", f.languages.join(","));
  if (f.verified) p.set("verified", "1");
  if (f.sort !== "best") p.set("sort", f.sort);
  return p;
}

export function activeFilterCount(f: CreatorFilters) {
  return (
    f.skills.length + f.categories.length + f.tools.length + f.contentTypes.length + f.styles.length +
    f.experience.length + f.availability.length + f.languages.length + (f.verified ? 1 : 0)
  );
}

const orNull = <T,>(a: T[]) => (a.length ? a : null);

function rpcArgs(f: CreatorFilters) {
  return {
    p_query: f.q.trim() || null,
    p_skills: orNull(f.skills),
    p_categories: orNull(f.categories),
    p_tools: orNull(f.tools),
    p_content_types: orNull(f.contentTypes),
    p_styles: orNull(f.styles),
    p_experience: orNull(f.experience),
    p_availability: orNull(f.availability),
    p_languages: orNull(f.languages),
    p_verified_only: f.verified,
  };
}

export async function searchCreators(db: DB, f: CreatorFilters, page = 0, size = 18): Promise<Page<CreatorCard & { _score: number }>> {
  const rows = unwrap(await db.rpc("search_creators", { ...rpcArgs(f), p_sort: f.sort, p_limit: size, p_offset: page * size }));
  return toPage(rows.map((r) => ({ ...as<CreatorCard>(r.creator), _score: r.score })), rows[0]?.total_count ?? 0, page, size);
}

/** For the empty state: how many results each active filter group is costing. */
export async function searchDiagnostics(db: DB, f: CreatorFilters) {
  const rows = unwrap(await db.rpc("search_creators_diagnostics", rpcArgs(f)));
  return rows.map((r) => ({ group: r.filter_group as FilterGroup, resultsWithout: r.results_without }));
}

/** "Related creators": relaxes AND-across-groups to match-any. */
export async function relatedCreators(db: DB, f: CreatorFilters, size = 6): Promise<CreatorCard[]> {
  const rows = unwrap(await db.rpc("search_creators", { ...rpcArgs(f), p_match: "any", p_limit: size }));
  return rows.map((r) => as<CreatorCard>(r.creator));
}

export interface DeckCard {
  creator: CreatorCard;
  score: number;
  reasons: string[];
  campaignId: string | null;
}

/** Creators the viewer hasn't moved past yet (or everyone, when includeSeen — used by "Reset"). */
export async function getSwipeDeck(db: DB, campaignId: string | null, size = 15, includeSeen = false): Promise<DeckCard[]> {
  const rows = unwrap(await db.rpc("get_swipe_deck", { p_campaign_id: campaignId, p_limit: size, p_include_seen: includeSeen }));
  return rows.map((r) => ({ creator: as<CreatorCard>(r.creator), score: r.score, reasons: r.reasons ?? [], campaignId: r.campaign_id }));
}

export async function rankForCampaign(db: DB, campaignId: string, page = 0, size = 12): Promise<Page<RankedCreator>> {
  const rows = unwrap(await db.rpc("rank_creators_for_campaign", { p_campaign_id: campaignId, p_limit: size, p_offset: page * size }));
  return toPage(
    rows.map((r) => ({
      creator: as<CreatorCard>(r.creator),
      score: r.score,
      breakdown: as<RankedCreator["breakdown"]>(r.breakdown),
      reasons: r.reasons ?? [],
      total_count: r.total_count,
    })),
    rows[0]?.total_count ?? 0, page, size,
  );
}

/** Ranking for a specific set of creators (used for compare & application scoring). */
export async function scoreCreators(db: DB, campaignId: string, creatorIds: string[]): Promise<Map<string, RankedCreator>> {
  if (!creatorIds.length) return new Map();
  const rows = unwrap(await db.rpc("rank_creators_for_campaign", { p_campaign_id: campaignId, p_limit: 60, p_only: creatorIds }));
  return new Map(rows.map((r) => {
    const c = as<CreatorCard>(r.creator);
    return [c.id, { creator: c, score: r.score, breakdown: as<RankedCreator["breakdown"]>(r.breakdown), reasons: r.reasons ?? [], total_count: r.total_count }];
  }));
}
