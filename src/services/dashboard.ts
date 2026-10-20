import { as, type DB, unwrap } from "./_db";

// All aggregation happens in Postgres (see supabase/migrations/0014_creator_dashboard.sql).
// Each RPC re-checks that the caller is the creator; raw tracking rows never reach the browser.

export interface DateRange {
  from: string; // YYYY-MM-DD (UTC day, inclusive)
  to: string;
}

export function previousRange({ from, to }: DateRange): DateRange {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
  const pTo = new Date(f.getTime() - 86_400_000);
  const pFrom = new Date(pTo.getTime() - (days - 1) * 86_400_000);
  return { from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) };
}

export interface SeriesPoint {
  day: string;
  views: number;
  watch_ms: number;
  likes: number;
  comments: number;
  saves: number;
  new_followers: number;
  followers: number;
  visits: number;
  inquiries: number;
  earnings: number;
  /** trailing 7-day (likes + comments + saves) / views × 100, computed in SQL */
  engagement_rate_7d: number | null;
}

export async function getSeries(db: DB, creatorId: string, r: DateRange): Promise<SeriesPoint[]> {
  return unwrap(await db.rpc("dashboard_series", { p_creator: creatorId, p_from: r.from, p_to: r.to })) as SeriesPoint[];
}

export interface PeriodTotals {
  views: number | null;
  watch_ms: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  engagements: number | null;
  engagement_rate: number | null;
  new_followers: number | null;
  followers: number | null;
  visits: number | null;
  inquiries: number | null;
  earnings: number | null;
}

export interface Summary {
  current: PeriodTotals;
  previous: PeriodTotals;
  currency: string;
  pending_payments: number;
  posts: number;
  has_activity: boolean;
}

export async function getSummary(db: DB, creatorId: string, r: DateRange): Promise<Summary> {
  return as<Summary>(unwrap(await db.rpc("dashboard_summary", { p_creator: creatorId, p_from: r.from, p_to: r.to })));
}

export interface PostPerformance {
  post_id: string;
  title: string;
  thumbnail: string | null;
  media_type: string;
  aspect_ratio: string;
  created_at: string;
  views: number;
  avg_watch_ms: number | null;
  likes: number;
  comments: number;
  saves: number;
  engagement_rate: number | null;
}

export async function getPostPerformance(db: DB, creatorId: string, r: DateRange): Promise<PostPerformance[]> {
  return unwrap(await db.rpc("dashboard_posts", { p_creator: creatorId, p_from: r.from, p_to: r.to, p_limit: 30 })) as PostPerformance[];
}

export interface GroupCount { label: string; count: number }
export interface Audience {
  min_group: number;
  audience_size: number;
  followers: number;
  anonymous_views: number;
  groups: { locations?: GroupCount[]; languages?: GroupCount[]; interests?: GroupCount[]; roles?: GroupCount[] };
  hidden: { locations?: number; languages?: number; interests?: number; roles?: number };
}

export async function getAudience(db: DB, creatorId: string, r: DateRange): Promise<Audience> {
  return as<Audience>(unwrap(await db.rpc("dashboard_audience", { p_creator: creatorId, p_from: r.from, p_to: r.to })));
}

export interface ContentGroup { label: string; posts: number; views: number; engagements: number; engagement_rate: number | null }
export type ContentInsights = Partial<Record<"content_type" | "category" | "style" | "tool" | "platform", ContentGroup[]>>;

export async function getContentInsights(db: DB, creatorId: string, r: DateRange): Promise<ContentInsights> {
  return as<ContentInsights>(unwrap(await db.rpc("dashboard_content", { p_creator: creatorId, p_from: r.from, p_to: r.to })));
}

export interface CareerRow {
  campaign_id: string;
  title: string;
  campaign_status: string;
  brand: string;
  app_status: string | null;
  applied_at: string | null;
  shortlisted_at: string | null;
  hired_at: string | null;
  hire_status: string | null;
  agreed_amount: number | null;
  currency: string;
  payment_status: string | null;
  paid_at: string | null;
  last_activity: string | null;
}
export interface Career {
  applications: number;
  pending: number;
  declined: number;
  shortlisted: number;
  hired: number;
  hired_from_applications: number;
  active: number;
  completed: number;
  earned: number;
  earned_in_range: number;
  pending_payments: number;
  rows: CareerRow[];
}

export async function getCareer(db: DB, creatorId: string, r: DateRange): Promise<Career> {
  return as<Career>(unwrap(await db.rpc("dashboard_career", { p_creator: creatorId, p_from: r.from, p_to: r.to })));
}

// ---------------------------------------------------------------------------
// AI insights (generated server-side from aggregated evidence, cached in creator_ai_insights)
// ---------------------------------------------------------------------------
export interface EvidenceArea { id: string; kind: string; label: string; posts: number; campaigns: number; workflows: number }
export interface AIInsights {
  generated_at: string;
  model: string | null;
  ai: boolean;
  strongest: { id: string; label: string; evidence: EvidenceArea }[];
  opportunities: { id: string; title: string; brand: string; score: number; why: string }[];
  ideas: { idea: string; based_on: { id: string; label: string }[] }[];
  trending: { id: string; label: string; campaigns: number }[];
  brands_want: string;
  totals: { posts: number; workflow_posts: number; campaigns: number; hired: number; active_campaigns: number };
}

export async function getCachedInsights(db: DB, creatorId: string): Promise<AIInsights | null> {
  const row = unwrap(await db.from("creator_ai_insights").select("insights, model, generated_at").eq("creator_id", creatorId).maybeSingle());
  if (!row) return null;
  return { ...(row.insights as unknown as AIInsights), generated_at: row.generated_at, model: row.model };
}

export async function refreshInsights(): Promise<AIInsights> {
  const res = await fetch("/api/dashboard/insights", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { insights?: AIInsights; error?: string };
  if (!res.ok || !body.insights) throw new Error(body.error ?? "Couldn't generate insights");
  return body.insights;
}

// ---------------------------------------------------------------------------
// Recording (fire-and-forget; de-duplicated and self-view-filtered in SQL)
// ---------------------------------------------------------------------------
export function recordPostView(db: DB, postId: string, watchMs?: number) {
  db.rpc("record_post_view", { p_post: postId, p_watch_ms: watchMs ?? null }).then(() => undefined, () => undefined);
}

export function recordProfileVisit(db: DB, creatorId: string) {
  db.rpc("record_profile_visit", { p_creator: creatorId }).then(() => undefined, () => undefined);
}
