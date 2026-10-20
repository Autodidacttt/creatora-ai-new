// Brand workspace + creator projects. Every call runs as the signed-in user: RLS and the workflow RPCs
// (0017) decide what is allowed. Media processing / AI / PDFs go through the API routes.
import type {
  BrandOverview, BrandSprint, Guideline, HiringCandidate, ProjectDetail, ProjectSummary,
  ReviewInboxItem, SubmissionDetail, SubmissionFile,
} from "@/types/workspace";
import type { GuidelineInput, SprintInput, StudioBrief, SubmissionDetails } from "@/lib/validation/workspace";
import { sampleVideoFrames } from "@/lib/media/client-frames";
import { as, type DB, requireUserId, ServiceError, unwrap } from "./_db";
import { toPage, type Page } from "./posts";

export const BUCKET_ORIGINALS = "submissions";
export const BUCKET_PREVIEWS = "submission-previews";

/** Storage calls return StorageError (not PostgrestError). */
function stored<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error || !res.data) throw new ServiceError(res.error?.message ?? "Upload failed");
  return res.data;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ServiceError((body as { error?: string }).error ?? `Request failed (${res.status})`, String(res.status));
  return body as T;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export async function getMyProjects(db: DB, filter: "active" | "completed" | "closed" | "all", page = 0, size = 20): Promise<Page<ProjectSummary>> {
  const rows = unwrap(await db.rpc("get_my_projects", { p_filter: filter, p_limit: size, p_offset: page * size }));
  return toPage(rows.map((r) => as<ProjectSummary>(r.project)), rows[0]?.total_count ?? 0, page, size);
}

export async function getProject(db: DB, id: string): Promise<ProjectDetail | null> {
  return as<ProjectDetail | null>(unwrap(await db.rpc("get_project", { p_project: id })));
}

export async function startProject(db: DB, id: string) {
  unwrap(await db.rpc("start_project", { p_project: id }));
}

export async function cancelProject(db: DB, id: string, reason: string) {
  unwrap(await db.rpc("cancel_project", { p_project: id, p_reason: reason }));
}

export async function leaveProjectReview(db: DB, projectId: string, subjectId: string, rating: number, body: string | null) {
  const me = await requireUserId(db);
  unwrap(await db.from("project_reviews").insert({ project_id: projectId, author_id: me, subject_id: subjectId, rating, body }));
}

// ---------------------------------------------------------------------------
// Submissions (creator)
// ---------------------------------------------------------------------------
export async function createSubmission(db: DB, projectId: string): Promise<string> {
  return unwrap(await db.rpc("create_submission", { p_project: projectId }));
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };

/** Uploads the original straight to private storage (own draft folder, RLS), then asks the server to build previews. */
export async function uploadSubmissionFile(db: DB, submissionId: string, file: File, position: number): Promise<SubmissionFile> {
  const me = await requireUserId(db);
  const ext = EXT[file.type];
  if (!ext) throw new ServiceError("Use JPG, PNG, WebP, MP4, WebM or MOV files.");
  const base = `${me}/${submissionId}/${crypto.randomUUID()}`;
  stored(await db.storage.from(BUCKET_ORIGINALS).upload(`${base}.${ext}`, file, { contentType: file.type, upsert: false }));

  const frames: string[] = [];
  let meta: { width?: number; height?: number; duration_ms?: number } = {};
  if (file.type.startsWith("video/")) {
    // Fallback stills in case the server can't transcode this video
    const probe = await sampleVideoFrames(file);
    meta = { width: probe.width, height: probe.height, duration_ms: probe.duration_ms };
    for (const [i, blob] of probe.frames.entries()) {
      const path = `${base}-frame-${i}.jpg`;
      const { error } = await db.storage.from(BUCKET_ORIGINALS).upload(path, blob, { contentType: "image/jpeg" });
      if (!error) frames.push(path);
    }
  }
  const res = await api<{ file: SubmissionFile }>(`/api/submissions/${submissionId}/files`, {
    method: "POST",
    body: JSON.stringify({ kind: "upload", path: `${base}.${ext}`, name: file.name, mime: file.type, position, frames, meta }),
  });
  return res.file;
}

export async function addSubmissionLink(submissionId: string, url: string, position: number): Promise<SubmissionFile> {
  return (await api<{ file: SubmissionFile }>(`/api/submissions/${submissionId}/files`, {
    method: "POST", body: JSON.stringify({ kind: "link", url, position }),
  })).file;
}

export async function removeSubmissionFile(submissionId: string, fileId: string) {
  await api(`/api/submissions/${submissionId}/files?file=${fileId}`, { method: "DELETE" });
}

export async function saveSubmissionDraft(db: DB, submissionId: string, d: Partial<Pick<SubmissionDetails, "notes" | "tools_used" | "workflow_notes">>) {
  unwrap(await db.from("submissions").update(d).eq("id", submissionId));
}

export async function submitSubmission(submissionId: string, details: SubmissionDetails) {
  await api(`/api/submissions/${submissionId}/submit`, { method: "POST", body: JSON.stringify(details) });
}

export async function addSubmissionComment(db: DB, submissionId: string, body: string, timestampMs: number | null, fileId: string | null) {
  const me = await requireUserId(db);
  unwrap(await db.from("submission_comments").insert({ submission_id: submissionId, author_id: me, body, timestamp_ms: timestampMs, file_id: fileId }));
}

// ---------------------------------------------------------------------------
// Creative Review (brand)
// ---------------------------------------------------------------------------
export interface InboxFilters {
  campaignId?: string | null;
  status?: "pending" | "revision_requested" | "approved" | "rejected" | "all";
  creatorId?: string | null;
}

export async function getReviewInbox(db: DB, f: InboxFilters, page = 0, size = 20): Promise<Page<ReviewInboxItem>> {
  const rows = unwrap(await db.rpc("get_review_inbox", {
    p_campaign: f.campaignId ?? null, p_status: f.status ?? "pending", p_creator: f.creatorId ?? null, p_limit: size, p_offset: page * size,
  }));
  return toPage(rows.map((r) => as<ReviewInboxItem>(r.item)), rows[0]?.total_count ?? 0, page, size);
}

export async function getSubmissionDetail(db: DB, id: string): Promise<SubmissionDetail | null> {
  return as<SubmissionDetail | null>(unwrap(await db.rpc("get_submission_detail", { p_submission: id })));
}

export async function reviewSubmission(db: DB, id: string, decision: "approved" | "revision_requested" | "rejected", feedback: string | null) {
  unwrap(await db.rpc("review_submission", { p_submission: id, p_decision: decision, p_feedback: feedback ?? undefined }));
}

export async function rerunAiReview(id: string) {
  await api(`/api/submissions/${id}/review-ai`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Hiring, sprints, delivery, escrow
// ---------------------------------------------------------------------------
export async function hireCreator(db: DB, campaignId: string, creatorId: string, amount: number, currency: string): Promise<string> {
  return unwrap(await db.rpc("hire_creator", { p_campaign: campaignId, p_creator: creatorId, p_amount: amount, p_currency: currency }));
}

export async function unhireCreator(db: DB, campaignId: string, creatorId: string) {
  unwrap(await db.rpc("unhire_creator", { p_campaign: campaignId, p_creator: creatorId }));
}

export async function getHiringBoard(db: DB, campaignId: string): Promise<HiringCandidate[]> {
  const rows = unwrap(await db.rpc("get_hiring_board", { p_campaign: campaignId }));
  return rows.map((r) => as<HiringCandidate>(r.candidate));
}

export async function getDeliveries(db: DB, filter: "active" | "completed" | "closed" | "all", page = 0, size = 30): Promise<Page<ProjectSummary>> {
  const rows = unwrap(await db.rpc("get_deliveries", { p_filter: filter, p_limit: size, p_offset: page * size }));
  return toPage(rows.map((r) => as<ProjectSummary>(r.project)), rows[0]?.total_count ?? 0, page, size);
}

export async function getBrandSprints(db: DB): Promise<BrandSprint[]> {
  return unwrap(await db.rpc("get_brand_sprints")).map((r) => as<BrandSprint>(r.sprint));
}

export async function getBrandOverview(db: DB): Promise<BrandOverview> {
  return as<BrandOverview>(unwrap(await db.rpc("get_brand_overview")));
}

export async function createSprint(db: DB, s: SprintInput): Promise<string> {
  const me = await requireUserId(db);
  const row = unwrap(await db.from("campaigns").insert({
    brand_id: me, title: s.title, description: s.description, deliverables: s.deliverables,
    budget_min: s.budget, budget_max: s.budget, currency: s.currency, aspect_ratios: s.aspect_ratios,
    is_sprint: true, sprint_deadline: new Date(Date.now() + s.hours * 3_600_000).toISOString(),
    creators_needed: 1, usage_rights: ["organic_social", "paid_social"], status: "active", ai_disclosure_required: true,
  }).select("id").single());
  return row.id;
}

export async function fundEscrow(db: DB, projectId: string) {
  unwrap(await db.rpc("fund_escrow", { p_project: projectId }));
}

export async function releasePayment(projectId: string): Promise<{ certificate_id: string; pdf: boolean }> {
  return api(`/api/projects/${projectId}/release`, { method: "POST" });
}

export async function refundEscrow(db: DB, projectId: string, reason: string) {
  unwrap(await db.rpc("refund_escrow", { p_project: projectId, p_reason: reason }));
}

export async function disputeEscrow(db: DB, projectId: string, reason: string) {
  unwrap(await db.rpc("dispute_escrow", { p_project: projectId, p_reason: reason }));
}

export const certificatePdfUrl = (code: string) => `/api/certificates/${code}`;
export const receiptPdfUrl = (projectId: string) => `/api/projects/${projectId}/receipt`;

// ---------------------------------------------------------------------------
// Signed media URLs (storage RLS decides: previews for parties; originals for the creator, and for the brand
// only after approval + funded escrow)
// ---------------------------------------------------------------------------
export async function signPreviews(db: DB, paths: string[], expiresIn = 600): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await db.storage.from(BUCKET_PREVIEWS).createSignedUrls(unique, expiresIn);
  if (error) throw new ServiceError(error.message);
  return Object.fromEntries((data ?? []).flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as const] : [])));
}

export async function signOriginal(db: DB, path: string, downloadName?: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET_ORIGINALS).createSignedUrl(path, 120, downloadName ? { download: downloadName } : undefined);
  if (error || !data) throw new ServiceError("Originals unlock once the work is approved and escrow is funded.");
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Brand guidelines
// ---------------------------------------------------------------------------
export async function listGuidelines(db: DB): Promise<Guideline[]> {
  const me = await requireUserId(db);
  return unwrap(await db.from("brand_guidelines").select("*").eq("brand_id", me).order("updated_at", { ascending: false })) as Guideline[];
}

export async function saveGuideline(db: DB, id: string | null, g: GuidelineInput): Promise<Guideline> {
  if (id) return unwrap(await db.from("brand_guidelines").update(g).eq("id", id).select("*").single()) as Guideline;
  const me = await requireUserId(db);
  return unwrap(await db.from("brand_guidelines").insert({ ...g, brand_id: me }).select("*").single()) as Guideline;
}

export async function uploadBrandLogo(db: DB, file: File): Promise<string> {
  const me = await requireUserId(db);
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
  if (!ext) throw new ServiceError("Use a PNG, JPG or WebP logo.");
  if (file.size > 5 * 1024 * 1024) throw new ServiceError("Logos must be under 5 MB.");
  const path = `${me}/logos/${crypto.randomUUID()}.${ext}`;
  stored(await db.storage.from("campaign-assets").upload(path, file, { contentType: file.type }));
  return db.storage.from("campaign-assets").getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Campaign Studio
// ---------------------------------------------------------------------------
export interface StudioIds {
  content_type_id: number | null;
  style_id: number | null;
  category_id: number | null;
  platform_ids: number[];
  tool_ids: number[];
}

export interface StudioDraft {
  id: string | null;
  step: 1 | 2 | 3 | 4;
  idea: string;
  url: string | null;
  urlSummary: string | null;
  brief: StudioBrief | null;
  ids: StudioIds;
  guidelineId: string | null;
  aiAssisted: boolean;
}

/** Autosave: creates the draft campaign on first save, then keeps it in sync. Returns the campaign id. */
export async function saveStudioDraft(db: DB, d: StudioDraft): Promise<string> {
  const b = d.brief;
  const deadline = b?.deadline_days ? new Date(Date.now() + b.deadline_days * 86_400_000).toISOString().slice(0, 10) : null;
  const fallbackTitle = (d.idea.split(/[.\n]/)[0] || d.urlSummary || "Untitled brief").trim().slice(0, 100);
  const row = {
    title: (b?.title || fallbackTitle).length >= 3 ? (b?.title || fallbackTitle) : "Untitled brief",
    description: b
      ? `${b.objective}\n\n${b.summary}`.slice(0, 4000)
      : (d.idea || d.urlSummary || "Draft brief in Campaign Studio").padEnd(10, ".").slice(0, 4000),
    deliverables: b ? b.deliverables.map((x) => `• ${x}`).join("\n").slice(0, 2000) : null,
    target_audience: b?.audience || null,
    content_type_id: d.ids.content_type_id,
    style_id: d.ids.style_id,
    category_id: d.ids.category_id,
    aspect_ratios: b?.aspect_ratios ?? [],
    budget_min: b?.budget.min ?? null,
    budget_max: b?.budget.max ?? null,
    currency: b?.budget.currency ?? "USD",
    deadline,
    creators_needed: b?.creators_needed ?? 1,
    usage_rights: b?.ip.usage_rights ?? [],
    territory: b?.ip.territory || "worldwide",
    usage_duration: b?.ip.usage_duration ?? "12_months",
    exclusivity: b?.ip.exclusivity ?? "none",
    license_type: b?.ip.license_type ?? "non_exclusive",
    ai_disclosure_required: b?.ip.ai_disclosure_required ?? true,
    ai_assisted: d.aiAssisted,
    source_idea: d.idea || null,
    source_url: d.url || null,
    source_summary: d.urlSummary?.slice(0, 3000) || null,
    ai_brief: b ?? null,
    suggested_tools: b?.suggested_tools ?? [],
    production_notes: b?.production ?? {},
    ip_terms: b ? { notes: b.ip.notes } : {},
    guideline_id: d.guidelineId,
    studio_step: d.step,
  };
  let id = d.id;
  if (id) {
    unwrap(await db.from("campaigns").update(row as never).eq("id", id));
  } else {
    const me = await requireUserId(db);
    id = unwrap(await db.from("campaigns").insert({ ...row, brand_id: me, status: "draft" } as never).select("id").single()).id;
  }
  for (const [table, col, ids] of [
    ["campaign_platforms", "platform_id", d.ids.platform_ids],
    ["campaign_tools", "tool_id", d.ids.tool_ids],
  ] as const) {
    unwrap(await db.from(table).delete().eq("campaign_id", id));
    if (ids.length) unwrap(await db.from(table).insert(ids.map((x) => ({ campaign_id: id, [col]: x })) as never));
  }
  return id;
}

/** Publishes the brief and notifies the best-matching creators. Returns how many were notified. */
export async function publishCampaign(db: DB, id: string): Promise<number> {
  return unwrap(await db.rpc("publish_campaign", { p_campaign: id }));
}

/** Returns false when this creator was already invited to the campaign. */
export async function inviteCreator(db: DB, campaignId: string, creatorId: string, note?: string): Promise<boolean> {
  return unwrap(await db.rpc("invite_creator", { p_campaign: campaignId, p_creator: creatorId, p_note: note ?? undefined }));
}

