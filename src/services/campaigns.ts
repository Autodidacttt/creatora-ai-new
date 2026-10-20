import type { CampaignCard, CampaignStatus, CreatorCard } from "@/types/app";
import type { CampaignInput } from "@/lib/validation/schemas";
import { as, type DB, requireUserId, unwrap, unwrapMaybe } from "./_db";
import { toPage, type Page } from "./posts";
import { recordInteraction } from "./social";

export async function getCampaign(db: DB, id: string): Promise<CampaignCard | null> {
  return as<CampaignCard | null>(unwrap(await db.rpc("get_campaign", { p_id: id })));
}

export async function getBrandCampaigns(db: DB, opts: { brandId?: string; status?: CampaignStatus | null } = {}, page = 0, size = 30) {
  const rows = unwrap(await db.rpc("get_brand_campaigns", {
    p_brand: opts.brandId ?? null, p_status: opts.status ?? null, p_limit: size, p_offset: page * size,
  }));
  return toPage(rows.map((r) => as<CampaignCard>(r.campaign)), rows[0]?.total_count ?? 0, page, size);
}

type CampaignValues = Omit<CampaignInput, "platform_ids" | "tool_ids" | "skill_ids" | "language_ids">;

function campaignRow(v: CampaignValues) {
  return {
    title: v.title,
    description: v.description,
    deliverables: v.deliverables ?? null,
    content_type_id: v.content_type_id,
    style_id: v.style_id,
    category_id: v.category_id,
    aspect_ratios: v.aspect_ratios,
    custom_aspect: v.aspect_ratios.includes("custom") ? v.custom_aspect ?? null : null,
    target_audience: v.target_audience ?? null,
    budget_min: v.budget_min ?? null,
    budget_max: v.budget_max ?? null,
    currency: v.currency,
    deadline: v.deadline || null,
    creators_needed: Number(v.creators_needed),
    usage_rights: v.usage_rights,
    territory: v.territory,
    usage_duration: v.usage_duration,
    exclusivity: v.exclusivity,
    license_type: v.license_type,
    ai_disclosure_required: v.ai_disclosure_required,
    ai_assisted: v.ai_assisted,
    status: v.status,
  };
}

async function setJoins(db: DB, campaignId: string, j: { platform_ids: number[]; tool_ids: number[]; skill_ids: number[]; language_ids: number[] }) {
  const sets: [string, string, number[]][] = [
    ["campaign_platforms", "platform_id", j.platform_ids],
    ["campaign_tools", "tool_id", j.tool_ids],
    ["campaign_skills", "skill_id", j.skill_ids],
    ["campaign_languages", "language_id", j.language_ids],
  ];
  for (const [table, col, ids] of sets) {
    unwrap(await db.from(table as "campaign_tools").delete().eq("campaign_id", campaignId));
    if (ids.length) {
      unwrap(await db.from(table as "campaign_tools").insert(ids.map((id) => ({ campaign_id: campaignId, [col]: id })) as never));
    }
  }
}

export async function createCampaign(db: DB, input: CampaignInput): Promise<string> {
  const brandId = await requireUserId(db);
  const { platform_ids, tool_ids, skill_ids, language_ids, ...values } = input;
  const row = unwrap(await db.from("campaigns").insert({ ...campaignRow(values), brand_id: brandId }).select("id").single());
  await setJoins(db, row.id, { platform_ids, tool_ids, skill_ids, language_ids });
  return row.id;
}

export async function updateCampaign(db: DB, id: string, input: CampaignInput) {
  const { platform_ids, tool_ids, skill_ids, language_ids, ...values } = input;
  unwrap(await db.from("campaigns").update(campaignRow(values)).eq("id", id));
  await setJoins(db, id, { platform_ids, tool_ids, skill_ids, language_ids });
}

export async function setCampaignStatus(db: DB, id: string, status: CampaignStatus) {
  unwrap(await db.from("campaigns").update({ status }).eq("id", id));
}

export async function deleteCampaign(db: DB, id: string) {
  unwrap(await db.from("campaigns").delete().eq("id", id));
}

// ---------------------------------------------------------------------------
// Brand pipeline
// ---------------------------------------------------------------------------
export interface Application {
  id: string;
  pitch: string;
  proposed_rate: number | null;
  status: "pending" | "rejected" | "withdrawn";
  created_at: string;
  creator: CreatorCard;
  shortlisted: boolean;
  selected: boolean;
}

export async function getApplications(db: DB, campaignId: string): Promise<Application[]> {
  const rows = unwrap(await db.rpc("get_campaign_applications", { p_campaign: campaignId }));
  return rows.map((r) => ({ ...r, status: r.status as Application["status"], creator: as<CreatorCard>(r.creator) }));
}

export interface PipelineEntry {
  creator: CreatorCard;
  stage: "shortlisted" | "selected" | "completed";
  note: string | null;
  created_at: string;
  applied: boolean;
}

export async function getPipeline(db: DB, campaignId: string): Promise<PipelineEntry[]> {
  const rows = unwrap(await db.rpc("get_campaign_pipeline", { p_campaign: campaignId }));
  return rows.map((r) => ({ ...r, stage: r.stage as PipelineEntry["stage"], creator: as<CreatorCard>(r.creator) }));
}

export async function setShortlisted(db: DB, campaignId: string, creatorId: string, on: boolean, note?: string) {
  const userId = await requireUserId(db);
  if (on) {
    unwrap(await db.from("campaign_shortlists").upsert(
      { campaign_id: campaignId, creator_id: creatorId, added_by: userId, note: note ?? null },
      { onConflict: "campaign_id,creator_id", ignoreDuplicates: true },
    ));
    await recordInteraction(db, "profile", creatorId, "shortlist", { campaign_id: campaignId }).catch(() => undefined);
  } else {
    unwrap(await db.from("campaign_shortlists").delete().eq("campaign_id", campaignId).eq("creator_id", creatorId));
  }
}

export async function setSelected(db: DB, campaignId: string, creatorId: string, on: boolean) {
  if (on) {
    unwrap(await db.from("campaign_creators").upsert(
      { campaign_id: campaignId, creator_id: creatorId, status: "selected" },
      { onConflict: "campaign_id,creator_id", ignoreDuplicates: true },
    ));
  } else {
    unwrap(await db.from("campaign_creators").delete().eq("campaign_id", campaignId).eq("creator_id", creatorId));
  }
}

export async function setApplicationStatus(db: DB, applicationId: string, status: "pending" | "rejected" | "withdrawn") {
  unwrap(await db.from("campaign_applications").update({ status }).eq("id", applicationId));
}

// ---------------------------------------------------------------------------
// Creator side
// ---------------------------------------------------------------------------
export interface Opportunity {
  campaign: CampaignCard;
  score: number;
  reasons: string[];
}

export async function getOpportunities(db: DB, tab: "for_you" | "saved" | "applied", page = 0, size = 12): Promise<Page<Opportunity>> {
  const rows = unwrap(await db.rpc("get_opportunities", { p_tab: tab, p_limit: size, p_offset: page * size }));
  return toPage(
    rows.map((r) => ({ campaign: as<CampaignCard>(r.campaign), score: r.score, reasons: r.reasons ?? [] })),
    rows[0]?.total_count ?? 0, page, size,
  );
}

export async function setSavedOpportunity(db: DB, campaignId: string, saved: boolean) {
  const userId = await requireUserId(db);
  if (saved) {
    unwrap(await db.from("saved_opportunities").upsert(
      { creator_id: userId, campaign_id: campaignId }, { onConflict: "creator_id,campaign_id", ignoreDuplicates: true }));
  } else {
    unwrap(await db.from("saved_opportunities").delete().eq("creator_id", userId).eq("campaign_id", campaignId));
  }
}

export async function ignoreOpportunity(db: DB, campaignId: string) {
  await recordInteraction(db, "campaign", campaignId, "ignore");
}

export async function apply(db: DB, campaignId: string, pitch: string, proposedRate: number | null) {
  const userId = await requireUserId(db);
  const existing = unwrapMaybe(await db.from("campaign_applications").select("id, status")
    .eq("campaign_id", campaignId).eq("creator_id", userId).maybeSingle());
  if (existing) {
    unwrap(await db.from("campaign_applications").update({ pitch, proposed_rate: proposedRate, status: "pending" }).eq("id", existing.id));
  } else {
    unwrap(await db.from("campaign_applications").insert({ campaign_id: campaignId, creator_id: userId, pitch, proposed_rate: proposedRate }));
  }
  await recordInteraction(db, "campaign", campaignId, "apply").catch(() => undefined);
}

export async function getDashboard(db: DB, role: "creator" | "brand") {
  const res = role === "brand" ? await db.rpc("get_brand_dashboard") : await db.rpc("get_creator_dashboard");
  return as<Record<string, number>>(unwrap(res));
}
