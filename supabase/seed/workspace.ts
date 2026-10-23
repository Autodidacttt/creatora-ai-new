// Brand workspace demo data: brand guidelines, a Studio draft, a live 48h sprint, and projects in every
// interesting state. Live states are produced by the REAL workflow (signed in as the demo users, calling the
// same RPCs and media pipeline as the app). Two older, completed projects are recorded as backdated history.
// Idempotent: every step checks what already exists and never touches non-demo users.
import { randomBytes, randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { issueCertificatePdf, processSubmissionFile, runSubmissionReview, BUCKET_ORIGINALS } from "../../src/lib/workspace/pipeline";
import type { StudioBrief } from "../../src/lib/validation/workspace";

export interface WorkspaceCtx {
  admin: SupabaseClient;
  url: string;
  publishableKey: string;
  password: string;
  uid: (key: string) => string;
  seedId: (key: string) => string;
  emailOf: (key: string) => string;
  usernameOf: (key: string) => string;
  log: (msg: string) => void;
}

const FONT = "src/assets/fonts/Geist-Regular.ttf";
const unsplash = (id: string, w = 1400, h = 1750) => `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80&fm=jpg`;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number, h = 0) => hoursAgo(d * 24 + h);

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function fetchBuffer(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Signed-in sessions (publishable key) — so seeded actions go through RLS + RPCs exactly like the app
const sessions = new Map<string, SupabaseClient>();
async function as(ctx: WorkspaceCtx, key: string) {
  if (sessions.has(key)) return sessions.get(key)!;
  const c = createClient(ctx.url, ctx.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: ctx.emailOf(key), password: ctx.password });
  if (error) throw new Error(`sign in ${key}: ${error.message}`);
  sessions.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// Brand guidelines (+ generated logos)
// ---------------------------------------------------------------------------
const GUIDELINES: Record<string, { name: string; initials: string; primary: string[]; secondary: string[]; fonts: string[]; tone: string; style: string; dos: string[]; donts: string[]; restricted: string; campaigns: string[] }> = {
  atelier: {
    name: "Atelier Nova — Brand DNA", initials: "AN", primary: ["#C8A27A", "#1F1B16"], secondary: ["#F3EDE4"],
    fonts: ["Canela", "Neue Haas Grotesk"], tone: "Quiet confidence. Poetic, never loud; French elegance with a Gen Z wink.",
    style: "Golden-hour light, film grain, warm neutrals and camel tones. Real fabric texture always visible. Models look candid, not posed.",
    dos: ["Show real garment texture up close", "Keep skin tones natural", "Leave negative space for copy"],
    donts: ["No neon or saturated purple", "Never crop the logo", "No heavy beauty retouching"],
    restricted: "No fur, no smoking, no real celebrities' likenesses.", campaigns: ["atelier-ss27", "atelier-holiday", "atelier-runway"],
  },
  orbitone: {
    name: "Orbitone — Product language", initials: "O", primary: ["#3D5AFE", "#0B0F1A"], secondary: ["#E3E8FF"],
    fonts: ["Söhne", "Söhne Mono"], tone: "Precise, calm, optimistic about technology.",
    style: "Dark studio worlds with electric-blue rim light; glass and liquid materials; slow, confident camera moves.",
    dos: ["Product geometry must match CAD exactly", "Use blue rim light"], donts: ["No lens flares", "No visible competitor devices"],
    restricted: "No medical or health claims.", campaigns: ["orbitone-arc", "orbitone-buds"],
  },
  tidewell: {
    name: "Tidewell — Sunny & sparkling", initials: "T", primary: ["#FFB703", "#219EBC"], secondary: ["#023047"],
    fonts: ["Recoleta", "Inter"], tone: "Playful, sunny, a little cheeky.",
    style: "Sun-drenched Mediterranean palette: warm yellow and ocean teal; bubbles, splashes, hard summer shadows.",
    dos: ["Can must be upright and readable", "Show bubbles and condensation"], donts: ["No alcohol cues", "No dull or overcast skies"],
    restricted: "Never show minors drinking; no alcohol.", campaigns: ["tidewell-summer", "tidewell-pos"],
  },
};

async function makeLogo(initials: string, bg: string, fg: string) {
  const { data } = await sharp({ text: { text: `<span foreground="${fg}" font_weight="bold">${initials}</span>`, fontfile: FONT, font: "Geist", rgba: true, dpi: 900 } })
    .png().toBuffer({ resolveWithObject: true });
  const meta = await sharp(data).metadata();
  return sharp({ create: { width: 512, height: 512, channels: 4, background: bg } })
    .composite([{ input: data, left: Math.round((512 - (meta.width ?? 0)) / 2), top: Math.round((512 - (meta.height ?? 0)) / 2) }])
    .png().toBuffer();
}

async function seedGuidelines(ctx: WorkspaceCtx) {
  for (const [brand, g] of Object.entries(GUIDELINES)) {
    const id = ctx.seedId(`guideline-${brand}`);
    const path = `${ctx.uid(brand)}/logos/seed-logo.png`;
    const logo = await makeLogo(g.initials, g.primary[1] ?? g.primary[0], g.primary[0]);
    check(await ctx.admin.storage.from("campaign-assets").upload(path, logo, { contentType: "image/png", upsert: true }), `logo ${brand}`);
    const logoUrl = ctx.admin.storage.from("campaign-assets").getPublicUrl(path).data.publicUrl;
    check(await ctx.admin.from("brand_guidelines").upsert({
      id, brand_id: ctx.uid(brand), name: g.name, logo_url: logoUrl, primary_colors: g.primary, secondary_colors: g.secondary,
      fonts: g.fonts, tone_of_voice: g.tone, visual_style: g.style, dos: g.dos, donts: g.donts, restricted_content: g.restricted,
    }, { onConflict: "id" }), `guidelines ${brand}`);
    check(await ctx.admin.from("campaigns").update({ guideline_id: id }).in("id", g.campaigns.map(ctx.seedId)).is("guideline_id", null), `attach guidelines ${brand}`);
  }
}

// ---------------------------------------------------------------------------
// A Campaign Studio draft (AI brief already structured, waiting on guidelines)
// ---------------------------------------------------------------------------
const STUDIO_BRIEF: StudioBrief = {
  title: "Yuzu Spritz launch: sun-drenched AI social films",
  objective: "Launch Tidewell's new sparkling yuzu soda to Gen Z in Spain and Portugal and drive first-week trial.",
  summary: "Three short vertical films where a summer afternoon literally fizzes: streets turn into rivers of bubbles, the can catches the light like a sun. Playful and a little surreal, always bright. The can is the hero in the last two seconds of every film.",
  audience: "18–26 year-olds in Spain and Portugal who live on TikTok and Reels",
  tone: "Playful, sunny, cheeky",
  deliverables: ["3 × 15s vertical films (9:16) with sound design", "3 × 6s cutdowns for paid social", "6 hero stills (4:5)"],
  content_type: null, style: null, category: null,
  platforms: [], aspect_ratios: ["9:16", "4:5"],
  timeline: "Moodboard in 3 days, first cuts in 7, finals in 12",
  deadline_days: 14,
  budget: { min: 5000, max: 8000, currency: "EUR", guidance: "Three hero films plus cutdowns and stills; usage includes paid social for 12 months. A rough market guide, not a quote." },
  requirements: ["Use the supplied can render for packshots", "Spanish and Portuguese end cards", "No alcohol cues"],
  suggested_tools: ["Runway", "Midjourney", "Kling"],
  production: {
    camera: "Low-angle tracking shots, quick whip-pans between scenes, macro on condensation drops.",
    lighting: "Hard Mediterranean afternoon sun, warm bounce, deep teal shadows.",
    style: "Saturated yellow/teal palette, light film grain, consistent can geometry across shots.",
    format: "9:16 with TikTok safe zones; 24fps; separate stems for music and SFX.",
  },
  ip: { usage_rights: ["organic_social", "paid_social"], territory: "Spain + Portugal", usage_duration: "12_months", exclusivity: "category", license_type: "non_exclusive", ai_disclosure_required: true, notes: "Creator keeps portfolio rights after launch." },
  creators_needed: 2,
};

async function seedStudioDraft(ctx: WorkspaceCtx) {
  const id = ctx.seedId("studio-draft-tidewell");
  check(await ctx.admin.from("campaigns").upsert({
    id, brand_id: ctx.uid("tidewell"), status: "draft", title: STUDIO_BRIEF.title,
    description: `${STUDIO_BRIEF.objective}\n\n${STUDIO_BRIEF.summary}`,
    deliverables: STUDIO_BRIEF.deliverables.map((d) => `• ${d}`).join("\n"), target_audience: STUDIO_BRIEF.audience,
    aspect_ratios: STUDIO_BRIEF.aspect_ratios, budget_min: 5000, budget_max: 8000, currency: "EUR", creators_needed: 2,
    usage_rights: STUDIO_BRIEF.ip.usage_rights, territory: STUDIO_BRIEF.ip.territory, usage_duration: "12_months",
    exclusivity: "category", license_type: "non_exclusive", ai_disclosure_required: true, ai_assisted: true,
    source_idea: "We're launching a sparkling yuzu soda for Gen Z in Spain and Portugal. Need 3 vertical AI films for TikTok and Reels — playful, sun-drenched, a bit surreal. Budget around €6k.",
    ai_brief: STUDIO_BRIEF, suggested_tools: STUDIO_BRIEF.suggested_tools, production_notes: STUDIO_BRIEF.production,
    ip_terms: { notes: STUDIO_BRIEF.ip.notes }, studio_step: 3, created_at: daysAgo(0, 5),
  }, { onConflict: "id", ignoreDuplicates: true }), "studio draft");
}

// ---------------------------------------------------------------------------
// Workflow helpers (as real users)
// ---------------------------------------------------------------------------
async function projectId(ctx: WorkspaceCtx, campaignKeyOrId: string, creator: string) {
  const campaignId = /^[0-9a-f-]{36}$/.test(campaignKeyOrId) ? campaignKeyOrId : ctx.seedId(campaignKeyOrId);
  const { data } = await ctx.admin.from("campaign_creators").select("id, status, hired_at").eq("campaign_id", campaignId).eq("creator_id", ctx.uid(creator)).maybeSingle();
  return data as { id: string; status: string; hired_at: string | null } | null;
}

/** Hires through the only path there is (0022): negotiate in chat → creator's final proposal → brand accepts. */
async function ensureHired(ctx: WorkspaceCtx, brand: string, campaign: string, creator: string, amount: number, _currency: string, fund: boolean) {
  const b = await as(ctx, brand);
  const p = await projectId(ctx, campaign, creator);
  const { data: escrow } = p ? await ctx.admin.from("escrow_payments").select("status").eq("campaign_creator_id", p.id).maybeSingle() : { data: null };
  if (!p?.hired_at || !escrow) {
    const c = await as(ctx, creator);
    const conv = check(await b.rpc("start_negotiation", { p_campaign: ctx.seedId(campaign), p_creator: ctx.uid(creator) }), `negotiate ${creator}`);
    const terms = { deliverables: "As described in the brief", deadline: null, revisions: 2, usage_rights: ["organic_social", "paid_social"] };
    const offer = check(await b.rpc("send_offer", { p_conversation: conv, p_price: amount, p_terms: terms }), `offer ${creator}`);
    check(await c.rpc("accept_offer", { p_message: offer }), `accept offer ${creator}`);
    const proposal = check(await c.rpc("send_final_proposal", { p_conversation: conv, p_note: null }), `final proposal ${creator}`);
    check(await b.rpc("hire_creator", { p_proposal: proposal }), `hire ${creator}`);
  }
  const proj = (await projectId(ctx, campaign, creator))!;
  if (fund) {
    const { data: e } = await ctx.admin.from("escrow_payments").select("status").eq("campaign_creator_id", proj.id).single();
    if (e?.status === "unfunded") check(await b.rpc("fund_escrow", { p_project: proj.id }), `fund ${creator}`);
  }
  return proj.id;
}

interface Media { url: string; name: string; mime: "image/jpeg" | "video/mp4" }

/** Creator uploads originals to their private draft folder (RLS), the pipeline builds previews, then they submit. */
async function submitAsCreator(ctx: WorkspaceCtx, creator: string, project: string, media: Media[], details: { notes: string; tools: string[]; workflow: string }, ai: GoogleGenAI | null) {
  const c = await as(ctx, creator);
  const subId = check(await c.rpc("create_submission", { p_project: project }), `draft ${creator}`) as string;
  const { count } = await ctx.admin.from("submission_files").select("id", { count: "exact", head: true }).eq("submission_id", subId);
  if (!count) {
    for (const [i, m] of media.entries()) {
      const path = `${ctx.uid(creator)}/${subId}/${randomUUID()}.${m.mime === "video/mp4" ? "mp4" : "jpg"}`;
      check(await c.storage.from(BUCKET_ORIGINALS).upload(path, await fetchBuffer(m.url), { contentType: m.mime }), `upload ${m.name}`);
      await processSubmissionFile(ctx.admin, { submissionId: subId, creatorId: ctx.uid(creator), username: ctx.usernameOf(creator), path, name: m.name, mime: m.mime, position: i });
    }
  }
  check(await c.from("submissions").update({
    notes: details.notes, tools_used: details.tools, workflow_notes: details.workflow, ai_generated_declared: true, commercial_terms_accepted: true,
  }).eq("id", subId), `details ${creator}`);
  check(await c.rpc("submit_submission", { p_submission: subId }), `submit ${creator}`);
  await runSubmissionReview(ctx.admin, subId, ai);
  return subId;
}

async function hasSubmissions(ctx: WorkspaceCtx, project: string) {
  const { count } = await ctx.admin.from("submissions").select("id", { count: "exact", head: true }).eq("project_id", project).neq("status", "draft");
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Live sprint
// ---------------------------------------------------------------------------
async function seedSprint(ctx: WorkspaceCtx, ai: GoogleGenAI | null) {
  const id = ctx.seedId("tidewell-sprint");
  const deadline = new Date(Date.now() + 28 * 3_600_000).toISOString();
  const { data: existing } = await ctx.admin.from("campaigns").select("id").eq("id", id).maybeSingle();
  if (!existing) {
    check(await ctx.admin.from("campaigns").insert({
      id, brand_id: ctx.uid("tidewell"), status: "active", is_sprint: true, sprint_deadline: deadline,
      deadline: deadline.slice(0, 10), created_at: hoursAgo(20), published_at: hoursAgo(20),
      title: "48h sprint: 3 sunny can loops for Friday's drop",
      description: "We need three seamless 8-second vertical loops of the Tidewell yuzu can for Friday's TikTok drop: bubbles, sunlight, a little magic. Fixed fee, fast turnaround.",
      deliverables: "3 × 8s seamless loops · 9:16 · no audio needed", budget_min: 900, budget_max: 900, currency: "USD",
      aspect_ratios: ["9:16"], usage_rights: ["organic_social", "paid_social"], territory: "Worldwide", ai_disclosure_required: true,
      guideline_id: ctx.seedId("guideline-tidewell"),
    }), "sprint");
  } else {
    // Keep the demo sprint live on every re-seed (service role; end users can't move a sprint deadline)
    check(await ctx.admin.from("campaigns").update({ sprint_deadline: deadline, deadline: deadline.slice(0, 10), status: "active" }).eq("id", id), "refresh sprint");
  }
  for (const [creator, pitch] of [
    ["diego", "Product loops are my thing — I'll keep the can geometry exact and make the bubbles do the work."],
    ["lena", "I'd make the loops pulse like a beat: sunlight flickers, bubbles rise on the downbeat."],
  ] as const) {
    check(await ctx.admin.from("campaign_applications").upsert(
      { id: ctx.seedId(`sprint-app-${creator}`), campaign_id: id, creator_id: ctx.uid(creator), pitch, proposed_rate: 900 },
      { onConflict: "campaign_id,creator_id", ignoreDuplicates: true }), `sprint application ${creator}`);
  }
  const diego = await projectId(ctx, id, "diego");
  if (diego && !(await hasSubmissions(ctx, diego.id))) {
    await submitAsCreator(ctx, "diego", diego.id,
      [{ url: "https://assets.mixkit.co/videos/32809/32809-720.mp4", name: "can-loop-01.mp4", mime: "video/mp4" }],
      { notes: "Loop 1 of 3 — seamless 8s, the can catches the sun on the beat. Loops 2 and 3 follow the same rig.", tools: ["Runway", "Kling", "After Effects"], workflow: "Can modelled from the packshot, animated in Kling, bubbles comped in After Effects, loop point matched by hand." },
      ai);
  }
}

// ---------------------------------------------------------------------------
// Backdated history: a completed, paid project with its licence record
// ---------------------------------------------------------------------------
const CODE_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function certificateCode() {
  const b = randomBytes(12);
  const chars = [...b].map((x) => CODE_ALPHABET[x % 34]);
  return `CRT-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

async function seedCompleted(ctx: WorkspaceCtx, o: { brand: string; campaign: string; creator: string; amount: number; currency: string; paidDaysAgo: number; media: Media[]; tools: string[]; notes: string }, ai: GoogleGenAI | null, siteUrl: string) {
  const p = await projectId(ctx, o.campaign, o.creator);
  if (!p || p.status !== "completed" || (await hasSubmissions(ctx, p.id))) return;
  const brandId = ctx.uid(o.brand), creatorId = ctx.uid(o.creator);
  const t = (dAgo: number) => daysAgo(dAgo);
  const submittedDays = o.paidDaysAgo + 6, approvedDays = o.paidDaysAgo + 2;

  const subId = ctx.seedId(`history-sub-${o.campaign}-${o.creator}`);
  check(await ctx.admin.from("submissions").insert({
    id: subId, project_id: p.id, campaign_id: ctx.seedId(o.campaign), creator_id: creatorId, version: 1, status: "approved",
    notes: o.notes, tools_used: o.tools, ai_generated_declared: true, commercial_terms_accepted: true,
    submitted_at: t(submittedDays), reviewed_at: t(approvedDays), created_at: t(submittedDays + 1),
  }), "history submission");
  for (const [i, m] of o.media.entries()) {
    const path = `${creatorId}/${subId}/${randomUUID()}.jpg`;
    check(await ctx.admin.storage.from(BUCKET_ORIGINALS).upload(path, await fetchBuffer(m.url), { contentType: m.mime }), "history upload");
    await processSubmissionFile(ctx.admin, { submissionId: subId, creatorId, username: ctx.usernameOf(o.creator), path, name: m.name, mime: m.mime, position: i });
  }
  check(await ctx.admin.from("submission_reviews").insert({ submission_id: subId, reviewer_id: brandId, decision: "approved", feedback: "Beautiful — exactly the warmth we wanted.", created_at: t(approvedDays) }), "history review");
  await runSubmissionReview(ctx.admin, subId, ai);

  const fee = Math.ceil(o.amount * 0.08);
  const escrow = check(await ctx.admin.from("escrow_payments").insert({
    campaign_creator_id: p.id, amount: o.amount, currency: o.currency, platform_fee: fee, status: "released",
    funded_at: t(submittedDays + 3), released_at: t(o.paidDaysAgo), created_at: t(submittedDays + 4),
  }).select("id").single(), "history escrow") as { id: string };
  const label = `${o.currency} ${o.amount.toLocaleString("en-GB")}`;
  check(await ctx.admin.from("payment_events").insert([
    { escrow_id: escrow.id, actor_id: brandId, event: "created", from_status: null, to_status: "unfunded", amount: o.amount, currency: o.currency, note: "Escrow opened on hire (test mode)", created_at: t(submittedDays + 4) },
    { escrow_id: escrow.id, actor_id: brandId, event: "funded", from_status: "unfunded", to_status: "funded", amount: o.amount, currency: o.currency, note: "Funded by the brand (test mode)", created_at: t(submittedDays + 3) },
    { escrow_id: escrow.id, actor_id: brandId, event: "released", from_status: "funded", to_status: "released", amount: o.amount, currency: o.currency, note: "Released on final approval (test mode)", created_at: t(o.paidDaysAgo) },
  ]), "history ledger");

  const code = certificateCode();
  const { data: c } = await ctx.admin.from("campaigns").select("title, usage_rights, territory, usage_duration, exclusivity, license_type, ai_disclosure_required, ip_terms, guideline_id").eq("id", ctx.seedId(o.campaign)).single();
  const { data: brandRow } = await ctx.admin.from("brand_details").select("company_name").eq("profile_id", brandId).single();
  const { data: creatorRow } = await ctx.admin.from("profiles").select("display_name, username").eq("id", creatorId).single();
  const { data: g } = c?.guideline_id ? await ctx.admin.from("brand_guidelines").select("version").eq("id", c.guideline_id).single() : { data: null };
  const { data: files } = await ctx.admin.from("submission_files").select("file_name, media_type, sha256, size_bytes, link_url, position").eq("submission_id", subId).order("position");
  check(await ctx.admin.from("ip_certificates").insert({
    certificate_id: code, campaign_creator_id: p.id, campaign_id: ctx.seedId(o.campaign), brand_id: brandId, creator_id: creatorId, submission_id: subId,
    terms: {
      campaign_title: c!.title, brand: brandRow?.company_name, creator: creatorRow?.display_name, creator_username: creatorRow?.username,
      usage_rights: c!.usage_rights, territory: c!.territory, usage_duration: c!.usage_duration, exclusivity: c!.exclusivity,
      license_type: c!.license_type, ai_disclosure_required: c!.ai_disclosure_required, ip_terms: c!.ip_terms,
      amount: o.amount, currency: o.currency, payment_mode: "internal_test_mode", submission_version: 1, approved_at: t(approvedDays),
      guideline_version: g?.version ?? null, ai_generated_declared: true,
    },
    tools_declared: o.tools,
    asset_hashes: (files ?? []).map((f) => ({ name: f.file_name, media_type: f.media_type, sha256: f.sha256, bytes: f.size_bytes, link: f.link_url })),
    generated_at: t(o.paidDaysAgo),
  }), "history certificate");
  await issueCertificatePdf(ctx.admin, code, siteUrl);

  // Timeline (recorded quietly — this is history, not news)
  const ev = (kind: string, event: string, dAgo: number, actor: string, extra: Record<string, unknown> = {}, note: string | null = null) =>
    ({ project_id: p.id, actor_id: actor, kind, event, to_status: kind === "status" ? event : null, note, data: extra, notify: false, created_at: t(dAgo) });
  check(await ctx.admin.from("project_events").insert([
    ev("status", "hired", submittedDays + 4, brandId, { amount_label: label }),
    ev("status", "in_progress", submittedDays + 3, creatorId),
    ev("payment", "funded", submittedDays + 3, brandId, { amount_label: label, test_mode: true }),
    ev("status", "submitted", submittedDays, creatorId, { version: 1, submission_id: subId }),
    ev("status", "approved", approvedDays, brandId, { version: 1, submission_id: subId }),
    ev("payment", "released", o.paidDaysAgo, brandId, { amount_label: label, test_mode: true }),
    ev("status", "completed", o.paidDaysAgo, brandId),
    ev("certificate", "issued", o.paidDaysAgo, brandId, { certificate_id: code }),
  ]), "history timeline");
  ctx.log(`    licence record ${code} (${o.creator} × ${o.campaign})`);
}

// ---------------------------------------------------------------------------
export async function seedWorkspace(ctx: WorkspaceCtx) {
  const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  const siteUrl = /^https:\/\//.test(process.env.SITE_URL ?? "") ? process.env.SITE_URL! : "https://creatora-ai-psi.vercel.app";
  if (!ai) ctx.log("  ! GEMINI_API_KEY not set — AI-assisted review checks will be marked unavailable");

  ctx.log("  - brand guidelines");
  await seedGuidelines(ctx);
  ctx.log("  - studio draft");
  await seedStudioDraft(ctx);

  ctx.log("  - completed + paid projects with licence records");
  await seedCompleted(ctx, {
    brand: "atelier", campaign: "atelier-holiday", creator: "sofia", amount: 3800, currency: "EUR", paidDaysAgo: 41,
    media: [
      { url: unsplash("1509631179647-0177331693ae"), name: "holiday-still-01.jpg", mime: "image/jpeg" },
      { url: unsplash("1490481651871-ab68de25d43d"), name: "holiday-still-02.jpg", mime: "image/jpeg" },
    ],
    tools: ["Midjourney", "Flux", "Photoshop"], notes: "Final hero stills for the holiday capsule, graded warm with real fabric composites.",
  }, ai, siteUrl);
  await seedCompleted(ctx, {
    brand: "atelier", campaign: "atelier-holiday", creator: "diego", amount: 1600, currency: "EUR", paidDaysAgo: 38,
    media: [{ url: unsplash("1523275335684-37898b6baf30", 1400, 1400), name: "accessory-still.jpg", mime: "image/jpeg" }],
    tools: ["Midjourney", "Photoshop"], notes: "Accessory still-life set.",
  }, ai, siteUrl);

  ctx.log("  - submission awaiting review (Orbitone × Kenji)");
  const kenji = await ensureHired(ctx, "orbitone", "orbitone-arc", "kenji", 12500, "USD", true);
  if (!(await hasSubmissions(ctx, kenji))) {
    await submitAsCreator(ctx, "kenji", kenji, [
      { url: unsplash("1617396900799-f4ec2b43c7ae", 1600, 900), name: "arc-lookdev-01.jpg", mime: "image/jpeg" },
      { url: unsplash("1626544827763-d516dce335e2", 1600, 900), name: "arc-lookdev-02.jpg", mime: "image/jpeg" },
    ], { notes: "First look-dev frames for the Arc launch film: liquid-glass world, blue rim light, product from your CAD.", tools: ["Blender", "Unreal Engine", "Runway"], workflow: "CAD retopo in Blender → glass shaders in Unreal → Runway for look variations." }, ai);
  }

  ctx.log("  - revision requested (Atelier Nova × Sofía)");
  const sofia = await ensureHired(ctx, "atelier", "atelier-ss27", "sofia", 6500, "EUR", true);
  if (!(await hasSubmissions(ctx, sofia))) {
    const sub = await submitAsCreator(ctx, "sofia", sofia, [
      { url: unsplash("1515886657613-9f3515b0c78f"), name: "ss27-golden-hour-01.jpg", mime: "image/jpeg" },
      { url: unsplash("1529139574466-a303027c1d8b"), name: "ss27-golden-hour-02.jpg", mime: "image/jpeg" },
    ], { notes: "Golden-hour chapter, first pass: two hero stills with the SS27 trench and knit set.", tools: ["Midjourney", "Flux", "Runway"], workflow: "Garment composites from your photography, model LoRA from holiday, grade in Lightroom." }, ai);
    const atelier = await as(ctx, "atelier");
    check(await atelier.rpc("review_submission", {
      p_submission: sub, p_decision: "revision_requested",
      p_feedback: "Love the light! Two changes: warm the grade on still 2 (it reads a little cold against our camel palette), and give the trench more fabric detail — the hem looks smoothed out.",
    }), "request revision");
  }

  ctx.log("  - 48h sprint in progress (Tidewell)");
  await seedSprint(ctx, ai);
}
