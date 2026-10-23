// Idempotent demo seed: `npm run seed`
// Creates 10 real Auth users (6 creators, 3 brands, 1 admin) through the Auth admin API and
// attaches all demo content to them using deterministic ids, so re-running only upserts.
// It never touches rows owned by non-demo users.
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "../scripts/env";
import { admin, brands, creators, DEMO_PASSWORD, type AdminSeed, type BrandSeed, type CreatorSeed } from "./data/accounts";
import { posts, type Aspect } from "./data/posts";
import { campaigns } from "./data/campaigns";
import {
  applications, comments, conversations, follows, likes, reports, savedOpportunities,
  saves, selections, shortlists, swipes, verifications,
} from "./data/social";
import { seedWorkspace } from "./workspace";

type Account = CreatorSeed | BrandSeed | AdminSeed;

const supabase: SupabaseClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accounts: Account[] = [...creators, ...brands, admin];
const userIds = new Map<string, string>();
const uid = (key: string) => {
  const id = userIds.get(key);
  if (!id) throw new Error(`Unknown account key "${key}"`);
  return id;
};

/** Deterministic UUID (v5-style) so every seed row has a stable id. */
function seedId(key: string): string {
  const h = createHash("sha1").update(`creatora-seed:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const daysAgo = (d: number) => ago(d * 24 * 60 + 37 * (d % 7));

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
type LookupTable = "skills" | "ai_tools" | "categories" | "content_types" | "styles" | "platforms" | "languages";
const lookups = new Map<LookupTable, Map<string, number>>();

async function loadLookups() {
  const tables: LookupTable[] = ["skills", "ai_tools", "categories", "content_types", "styles", "platforms", "languages"];
  for (const t of tables) {
    const rows = check(await supabase.from(t).select("id, slug"), `load ${t}`) as { id: number; slug: string }[];
    if (!rows.length) throw new Error(`Lookup table ${t} is empty — run "npm run db:migrate" first.`);
    lookups.set(t, new Map(rows.map((r) => [r.slug, r.id])));
  }
}
function lk(table: LookupTable, slug: string): number {
  const id = lookups.get(table)?.get(slug);
  if (id === undefined) throw new Error(`Unknown ${table} slug "${slug}"`);
  return id;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
const SIZES: Record<Aspect, [number, number]> = {
  "16:9": [1600, 900], "9:16": [1080, 1920], "1:1": [1200, 1200],
  "4:5": [1200, 1500], "4:3": [1600, 1200], "21:9": [1890, 810],
};
const unsplash = (id: string, w: number, h: number, crop = "entropy") =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&crop=${crop}&q=80&fm=jpg`;

const existingObjects = new Map<string, Set<string>>();
async function objectExists(bucket: string, folder: string, name: string) {
  const cacheKey = `${bucket}/${folder}`;
  if (!existingObjects.has(cacheKey)) {
    const { data } = await supabase.storage.from(bucket).list(folder, { limit: 1000 });
    existingObjects.set(cacheKey, new Set((data ?? []).map((o) => o.name)));
  }
  return existingObjects.get(cacheKey)!.has(name);
}

/** Copies a remote royalty-free file into Storage; falls back to the remote URL if anything fails. */
async function mirror(bucket: string, folder: string, name: string, url: string): Promise<string> {
  const path = `${folder}/${name}`;
  const publicUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  try {
    if (await objectExists(bucket, folder, name)) return publicUrl;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = new Uint8Array(await res.arrayBuffer());
    const { error } = await supabase.storage.from(bucket).upload(path, body, {
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      upsert: true,
    });
    if (error) throw error;
    return publicUrl;
  } catch (err) {
    console.warn(`  ! could not mirror ${name} (${err instanceof Error ? err.message : err}); using remote URL`);
    return url;
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
async function ensureUsers() {
  const byEmail = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    data.users.forEach((u) => u.email && byEmail.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 1000) break;
  }

  for (const a of accounts) {
    const metadata = { role: a.role === "admin" ? "creator" : a.role, display_name: a.displayName, username: a.username };
    let id = byEmail.get(a.email);
    if (id) {
      const { error } = await supabase.auth.admin.updateUserById(id, { password: DEMO_PASSWORD, email_confirm: true });
      if (error) throw new Error(`update ${a.email}: ${error.message}`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: a.email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: metadata,
      });
      if (error || !data.user) throw new Error(`create ${a.email}: ${error?.message}`);
      id = data.user.id;
      console.log(`  + created ${a.email}`);
    }
    userIds.set(a.key, id);
  }
}

async function seedProfiles(coverByCreator: Map<string, string>) {
  await pool(accounts, 4, async (a) => {
    const id = uid(a.key);
    const avatarUrl = await mirror("avatars", id, "avatar.jpg", unsplash(a.avatar, 400, 400, a.role === "brand" ? "entropy" : "faces"));
    const base = {
      role: a.role,
      username: a.username,
      display_name: a.displayName,
      avatar_url: avatarUrl,
      headline: a.headline,
      bio: a.bio,
      location: a.location,
      website: "website" in a ? a.website ?? null : null,
      links: "links" in a ? a.links : {},
      onboarded: true,
      is_verified: a.role === "creator" ? a.verified : a.role === "brand",
      cover_url: coverByCreator.get(a.key) ?? null,
    };
    check(await supabase.from("profiles").update(base).eq("id", id), `profile ${a.key}`);
    check(await supabase.from("profile_stats").upsert({ profile_id: id }, { onConflict: "profile_id", ignoreDuplicates: true }), "stats row");

    if (a.role === "creator") {
      check(await supabase.from("creator_details").upsert({
        profile_id: id,
        experience_level: a.experience,
        availability: a.availability,
        years_experience: a.years,
        rate_min: a.rate[0],
        rate_max: a.rate[1],
        currency: a.currency,
        workflow_overview: a.workflowOverview,
      }), `creator_details ${a.key}`);
      await supabase.from("brand_details").delete().eq("profile_id", id);

      const joins: [string, string, string, (s: string) => number, (string | [string, string])[]][] = [
        ["creator_tools", "tool_id", "ai_tools", (s) => lk("ai_tools", s), a.tools],
        ["creator_skills", "skill_id", "skills", (s) => lk("skills", s), a.skills],
        ["creator_categories", "category_id", "categories", (s) => lk("categories", s), a.categories],
        ["creator_content_types", "content_type_id", "content_types", (s) => lk("content_types", s), a.contentTypes],
        ["creator_styles", "style_id", "styles", (s) => lk("styles", s), a.styles],
        ["creator_languages", "language_id", "languages", (s) => lk("languages", s), a.languages],
        ["creator_platforms", "platform_id", "platforms", (s) => lk("platforms", s), a.platforms],
      ];
      for (const [table, col, , resolve, values] of joins) {
        check(await supabase.from(table).delete().eq("creator_id", id), `clear ${table}`);
        const rows = values.map((v) =>
          Array.isArray(v)
            ? { creator_id: id, [col]: resolve(v[0]), proficiency: v[1] }
            : { creator_id: id, [col]: resolve(v) });
        check(await supabase.from(table).insert(rows), `insert ${table}`);
      }

      check(await supabase.from("creator_experiences").upsert(a.experiences.map((e) => ({
        id: seedId(e.key), creator_id: id, brand_name: e.brand, project_title: e.project,
        year: e.year, description: e.description, link: e.link ?? null,
      }))), `experiences ${a.key}`);
    } else if (a.role === "brand") {
      check(await supabase.from("brand_details").upsert({
        profile_id: id, company_name: a.company, industry: a.industry, company_size: a.size, description: a.description,
      }), `brand_details ${a.key}`);
      await supabase.from("creator_details").delete().eq("profile_id", id);
    } else {
      await supabase.from("creator_details").delete().eq("profile_id", id);
    }
  });
}

async function seedPosts(): Promise<Map<string, string>> {
  const coverByCreator = new Map<string, string>();
  const rows = await pool(posts, 6, async (p) => {
    const creatorId = uid(p.creator);
    let mediaUrl: string;
    let thumb: string | null = null;
    if (p.video) {
      mediaUrl = `https://assets.mixkit.co/videos/${p.video}/${p.video}-720.mp4`;
      thumb = await mirror("post-media", creatorId, `${p.key}-thumb.jpg`,
        `https://assets.mixkit.co/videos/${p.video}/${p.video}-thumb-720-0.jpg`);
    } else {
      const [w, h] = SIZES[p.aspect];
      mediaUrl = await mirror("post-media", creatorId, `${p.key}.jpg`, unsplash(p.image!, w, h));
    }
    return {
      id: seedId(p.key),
      creator_id: creatorId,
      title: p.title,
      description: p.description,
      media_type: p.video ? "video" : "image",
      media_url: mediaUrl,
      thumbnail_url: thumb,
      aspect_ratio: p.aspect,
      content_type_id: lk("content_types", p.contentType),
      style_id: lk("styles", p.style),
      category_id: lk("categories", p.category),
      commercial_use_cleared: p.commercial,
      workflow_notes: p.notes,
      workflow_steps: p.steps.map(([tool, step]) => ({ tool_id: lk("ai_tools", tool), step })),
      created_at: daysAgo(p.daysAgo * 2 + 1), // spread over ~4 months so dashboard history lands on live posts
    };
  });
  check(await supabase.from("posts").upsert(rows), "posts");

  const postIds = rows.map((r) => r.id);
  check(await supabase.from("post_tools").delete().in("post_id", postIds), "clear post_tools");
  check(await supabase.from("post_tools").insert(posts.flatMap((p) =>
    [...new Set(p.tools)].map((t) => ({ post_id: seedId(p.key), tool_id: lk("ai_tools", t) })))), "post_tools");

  // Profile cover = the creator's most recent image
  for (const p of [...posts].sort((a, b) => b.daysAgo - a.daysAgo)) {
    const row = rows.find((r) => r.id === seedId(p.key))!;
    coverByCreator.set(p.creator, row.thumbnail_url ?? row.media_url);
  }
  return coverByCreator;
}

async function seedSocial() {
  check(await supabase.from("follows").upsert(
    follows.map(([a, b], i) => ({ follower_id: uid(a), following_id: uid(b), created_at: ago(9000 - i * 300) })),
    { onConflict: "follower_id,following_id", ignoreDuplicates: true }), "follows");
  check(await supabase.from("likes").upsert(
    likes.map(([u, p], i) => ({ user_id: uid(u), post_id: seedId(p), created_at: ago(8000 - i * 150) })),
    { onConflict: "user_id,post_id", ignoreDuplicates: true }), "likes");
  // Broader, deterministic engagement between demo accounts (real rows from real demo users)
  const others = [...creators, ...brands].map((a) => a.key);
  const roll = (k: string) => createHash("sha1").update(k).digest().readUInt16BE(0) / 65535;
  const extraLikes = posts.flatMap((p) => others.filter((u) => u !== p.creator && roll(`like:${u}:${p.key}`) < 0.4).map((u) => ({ user_id: uid(u), post_id: seedId(p.key) })));
  const extraSaves = posts.flatMap((p) => others.filter((u) => u !== p.creator && roll(`save:${u}:${p.key}`) < (brands.some((b) => b.key === u) ? 0.25 : 0.1)).map((u) => ({ user_id: uid(u), post_id: seedId(p.key) })));
  check(await supabase.from("likes").upsert(extraLikes, { onConflict: "user_id,post_id", ignoreDuplicates: true }), "extra likes");
  check(await supabase.from("saves").upsert(extraSaves, { onConflict: "user_id,post_id", ignoreDuplicates: true }), "extra saves");
  check(await supabase.from("saves").upsert(
    saves.map(([u, p]) => ({ user_id: uid(u), post_id: seedId(p) })),
    { onConflict: "user_id,post_id", ignoreDuplicates: true }), "saves");
  check(await supabase.from("comments").upsert(
    comments.map(([key, u, p, body, min]) => ({ id: seedId(key), user_id: uid(u), post_id: seedId(p), body, created_at: ago(min) })),
    { onConflict: "id", ignoreDuplicates: true }), "comments");

  // Seeded swipe signals are tagged so a re-seed replaces only these rows
  const demoIds = [...userIds.values()];
  check(await supabase.from("interactions").delete().in("user_id", demoIds).contains("context", { seed: true }), "clear interactions");
  check(await supabase.from("interactions").insert(swipes.map(([u, c, action]) => ({
    user_id: uid(u), target_type: "profile", target_id: uid(c), action,
    weight: action === "swipe_right" ? 2 : -1, context: { seed: true },
  }))), "interactions");
}

async function seedCampaigns() {
  const rows = campaigns.map((c) => ({
    id: seedId(c.key),
    brand_id: uid(c.brand),
    title: c.title,
    description: c.description,
    deliverables: c.deliverables,
    content_type_id: lk("content_types", c.contentType),
    style_id: lk("styles", c.style),
    category_id: lk("categories", c.category),
    aspect_ratios: c.aspects,
    target_audience: c.audience,
    budget_min: c.budget[0],
    budget_max: c.budget[1],
    currency: c.currency,
    deadline: new Date(Date.now() + c.deadlineInDays * 86_400_000).toISOString().slice(0, 10),
    creators_needed: c.creatorsNeeded,
    usage_rights: c.usageRights,
    territory: c.territory,
    usage_duration: c.duration,
    exclusivity: c.exclusivity,
    license_type: c.license,
    ai_disclosure_required: c.aiDisclosure,
    ai_assisted: c.aiAssisted,
    status: c.status,
    published_at: c.status === "draft" ? null : daysAgo(c.daysAgo),
    created_at: daysAgo(c.daysAgo),
  }));
  check(await supabase.from("campaigns").upsert(rows), "campaigns");

  const ids = rows.map((r) => r.id);
  const joins: [string, string, LookupTable, keyof (typeof campaigns)[number]][] = [
    ["campaign_platforms", "platform_id", "platforms", "platforms"],
    ["campaign_tools", "tool_id", "ai_tools", "tools"],
    ["campaign_skills", "skill_id", "skills", "skills"],
    ["campaign_languages", "language_id", "languages", "languages"],
  ];
  for (const [table, col, lookup, field] of joins) {
    check(await supabase.from(table).delete().in("campaign_id", ids), `clear ${table}`);
    const jr = campaigns.flatMap((c) => (c[field] as string[]).map((s) => ({ campaign_id: seedId(c.key), [col]: lk(lookup, s) })));
    if (jr.length) check(await supabase.from(table).insert(jr), table);
  }

  check(await supabase.from("campaign_applications").upsert(applications.map(([key, c, cr, pitch, rate, status], i) => ({
    id: seedId(key), campaign_id: seedId(c), creator_id: uid(cr), pitch, proposed_rate: rate, status,
    created_at: ago(5000 - i * 400),
  })), { onConflict: "campaign_id,creator_id", ignoreDuplicates: true }), "applications");

  check(await supabase.from("campaign_shortlists").upsert(shortlists.map(([c, cr, note]) => {
    const brand = campaigns.find((x) => x.key === c)!.brand;
    return { campaign_id: seedId(c), creator_id: uid(cr), added_by: uid(brand), note };
  }), { onConflict: "campaign_id,creator_id", ignoreDuplicates: true }), "shortlists");

  check(await supabase.from("campaign_creators").upsert(selections.map(([c, cr, status, amount, paidDaysAgo]) => ({
    campaign_id: seedId(c), creator_id: uid(cr), status, created_at: daysAgo(70), hired_at: daysAgo(70),
    completed_at: paidDaysAgo === null ? null : daysAgo(paidDaysAgo), status_changed_at: paidDaysAgo === null ? daysAgo(70) : daysAgo(paidDaysAgo),
    // Open hires agree their fee by negotiating (seed/workspace.ts ensureHired); finished ones carry the fee they were paid
    agreed_amount: status === "completed" ? amount : null, currency: campaigns.find((x) => x.key === c)!.currency,
    payment_status: paidDaysAgo === null ? "pending" : "paid", paid_at: paidDaysAgo === null ? null : daysAgo(paidDaysAgo),
  })), { onConflict: "campaign_id,creator_id", ignoreDuplicates: true }), "selections");
  // Every hire comes from an accepted final proposal (0022); the finished history gets its record here
  check(await supabase.from("proposals").upsert(selections.filter(([, , status]) => status === "completed").map(([c, cr, , amount]) => ({
    campaign_id: seedId(c), creator_id: uid(cr), version: 1, price: amount, currency: campaigns.find((x) => x.key === c)!.currency,
    terms: { deliverables: "As described in the brief", deadline: null, revisions: 2, usage_rights: ["organic_social", "paid_social"] },
    status: "accepted", sent_at: daysAgo(71), decided_at: daysAgo(70), created_at: daysAgo(71),
  })), { onConflict: "campaign_id,creator_id,version", ignoreDuplicates: true }), "accepted proposals for past hires");

  check(await supabase.from("saved_opportunities").upsert(savedOpportunities.map(([cr, c]) => ({
    creator_id: uid(cr), campaign_id: seedId(c),
  })), { onConflict: "creator_id,campaign_id", ignoreDuplicates: true }), "saved opportunities");
}

async function seedConversations() {
  for (const [key, a, b, msgs] of conversations) {
    const [x, y] = [uid(a), uid(b)].sort();
    const dmKey = `${x}:${y}`;
    // Reuse the thread if the pair already talked through the app (its id won't be the seed id)
    const existing = check(await supabase.from("conversations").select("id").eq("dm_key", dmKey).maybeSingle(),
      `find conversation ${key}`) as { id: string } | null;
    const conv = existing ?? (check(await supabase.from("conversations")
      .insert({ id: seedId(key), dm_key: dmKey }).select("id").single(), `conversation ${key}`) as { id: string });

    check(await supabase.from("conversation_participants").upsert(
      [{ conversation_id: conv.id, user_id: uid(a) }, { conversation_id: conv.id, user_id: uid(b) }],
      { onConflict: "conversation_id,user_id", ignoreDuplicates: true }), "participants");

    // Insert in chronological order so triggers keep last_message_* correct
    for (const [i, [sender, body, min]] of msgs.entries()) {
      check(await supabase.from("messages").upsert({
        id: seedId(`${key}-m${i}`), conversation_id: conv.id, sender_id: uid(sender), body, created_at: ago(min),
      }, { onConflict: "id", ignoreDuplicates: true }), "message");
    }

    // Everything is read except the final message, which stays unread for its recipient
    const last = msgs[msgs.length - 1];
    const prev = msgs.length > 1 ? msgs[msgs.length - 2] : null;
    for (const who of [a, b]) {
      const readAt = who === last[0] ? ago(last[2]) : prev ? ago(prev[2]) : new Date(0).toISOString();
      check(await supabase.from("conversation_participants").update({ last_read_at: readAt })
        .eq("conversation_id", conv.id).eq("user_id", uid(who)), "read marker");
    }
    check(await supabase.from("conversations").update({
      last_message_at: ago(last[2]), last_message_preview: last[1].slice(0, 140), last_sender_id: uid(last[0]),
    }).eq("id", conv.id), "conversation summary");
  }
}

async function seedTrust() {
  const adminId = uid("admin");
  check(await supabase.from("verifications").upsert(verifications.map((v, i) => ({
    id: seedId(v.key),
    creator_id: uid(v.creator),
    type: v.type,
    tool_id: v.tool ? lk("ai_tools", v.tool) : null,
    post_id: v.post ? seedId(v.post) : null,
    experience_id: v.experience ? seedId(v.experience) : null,
    title: v.title,
    evidence_url: v.evidenceUrl ?? null,
    evidence_notes: v.notes,
    status: v.status,
    reviewed_by: v.status === "approved" ? adminId : null,
    reviewed_at: v.status === "approved" ? daysAgo(20 - i) : null,
    created_at: daysAgo(30 - i),
  }))), "verifications");

  check(await supabase.from("reports").upsert(reports.map((r) => ({
    id: seedId(r.key), reporter_id: uid(r.reporter), target_type: r.targetType, target_id: seedId(r.post),
    reason: r.reason, details: r.details,
  })), { onConflict: "id", ignoreDuplicates: true }), "reports");
}

// 90 days of views / visits per demo creator: weekly rhythm, one viral spike, one dip (see seed_dashboard_history)
const HISTORY: Record<string, { base: number; spike: number; dip: [number, number] }> = {
  maya: { base: 14, spike: 38, dip: [20, 15] },
  kenji: { base: 10, spike: 55, dip: [12, 8] },
  sofia: { base: 18, spike: 24, dip: [62, 57] },
  arjun: { base: 7, spike: 70, dip: [30, 26] },
  lena: { base: 12, spike: 11, dip: [45, 40] },
  diego: { base: 9, spike: 48, dip: [18, 14] },
};

async function seedDashboardHistory() {
  const demoIds = [...userIds.values()];
  for (const c of creators) {
    const h = HISTORY[c.key];
    if (!h) continue;
    check(await supabase.rpc("seed_dashboard_history", {
      p_creator: uid(c.key), p_demo_ids: demoIds.filter((id) => id !== uid(c.key)),
      p_base: h.base, p_spike_days_ago: h.spike, p_dip_from: h.dip[0], p_dip_to: h.dip[1],
    }), `history ${c.key}`);
  }
}

async function main() {
  const t0 = Date.now();
  console.log("Seeding Creatora demo data…");
  await loadLookups();
  console.log("• users");
  await ensureUsers();
  console.log("• posts & media");
  const covers = await seedPosts();
  console.log("• profiles");
  await seedProfiles(covers);
  console.log("• social graph");
  await seedSocial();
  console.log("• campaigns");
  await seedCampaigns();
  console.log("• conversations");
  await seedConversations();
  console.log("• verification & moderation");
  await seedTrust();
  console.log("• 90-day dashboard history");
  await seedDashboardHistory();
  console.log("• brand workspace (guidelines, sprint, submissions, escrow, licence records)");
  const account = (key: string) => accounts.find((a) => a.key === key)!;
  await seedWorkspace({
    admin: supabase, url: requireEnv("SUPABASE_URL"), publishableKey: requireEnv("SUPABASE_PUBLISHABLE_KEY"), password: DEMO_PASSWORD,
    uid, seedId, emailOf: (k) => account(k).email, usernameOf: (k) => account(k).username, log: (m) => console.log(m),
  });
  check(await supabase.rpc("recompute_stats"), "recompute_stats");

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. Demo logins (password: ${DEMO_PASSWORD}):`);
  for (const a of accounts) console.log(`  ${a.role.padEnd(8)} ${a.email}`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
