// End-to-end acceptance test for the brand workspace, against a running app (APP_URL, default http://localhost:3000).
// Throwaway brand + creator accounts drive the whole flow through the real API routes (browser-style cookies)
// and RPCs (publishable key), plus cross-user attacks. Everything created here is deleted at the end.
// Usage: npm run test:workspace   (APP_URL=https://… to run against a deployment)
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { requireEnv } from "./env";
import { DEMO_PASSWORD, brands, creators } from "../seed/data/accounts";
import { seedId } from "../seed/ids";

const URL_ = requireEnv("SUPABASE_URL");
const PUB = requireEnv("SUPABASE_PUBLISHABLE_KEY");
const SECRET = requireEnv("SUPABASE_SECRET_KEY");
const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

let passes = 0, failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passes++; else failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
const client = () => createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

interface Session { c: SupabaseClient; id: string; cookie: string }
async function signIn(email: string, password: string): Promise<Session> {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  const jar = new Map<string, string>();
  const ssr = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
  await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return { c, id: data.user.id, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}
const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(APP + path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });

async function image(color: string, w = 1080, h = 1350) {
  // A real JPEG whose dominant colour is the brand colour, with a dark band (so palettes have >1 colour)
  return sharp({ create: { width: w, height: h, channels: 3, background: color } })
    .composite([{ input: await sharp({ create: { width: w, height: Math.round(h * 0.25), channels: 3, background: "#1A1A1A" } }).png().toBuffer(), top: Math.round(h * 0.75), left: 0 }])
    .jpeg({ quality: 90 }).toBuffer();
}

async function waitForReview(c: SupabaseClient, submissionId: string, timeoutMs = 150_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await c.from("ai_review_results").select("status, brand_match_score, checks, model_name, error").eq("submission_id", submissionId).maybeSingle();
    if (data && (data.status === "done" || data.status === "failed")) return data;
    await sleep(3000);
  }
  return null;
}

async function main() {
  const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  const health = await fetch(APP, { redirect: "manual" }).catch(() => null);
  if (!health) throw new Error(`App isn't reachable at ${APP} — start it (npm run dev / npm start) or set APP_URL.`);

  const stamp = Date.now();
  const pw = `Ws-${stamp}-Aa1!`;
  const mk = async (role: "brand" | "creator", name: string) => {
    const r = await admin.auth.admin.createUser({ email: `ws-${role}-${stamp}@example.com`, password: pw, email_confirm: true, user_metadata: { role, display_name: name } });
    if (r.error || !r.data.user) throw new Error(r.error?.message);
    return r.data.user.id;
  };
  const created: string[] = [];
  try {
    created.push(await mk("brand", "WS Test Brand"), await mk("creator", "WS Test Creator"));
    const brand = await signIn(`ws-brand-${stamp}@example.com`, pw);
    const creator = await signIn(`ws-creator-${stamp}@example.com`, pw);
    const maya = await signIn(creators.find((c) => c.key === "maya")!.email, DEMO_PASSWORD);
    const orbitone = await signIn(brands.find((b) => b.key === "orbitone")!.email, DEMO_PASSWORD);

    console.log(`\n▸ New users start empty (${APP})`);
    const mine = await creator.c.rpc("get_my_projects", { p_filter: "all", p_limit: 50, p_offset: 0 });
    check("new creator has no projects", !mine.error && mine.data?.length === 0, mine.error?.message);
    const ov = (await brand.c.rpc("get_brand_overview")).data as { campaigns: number; pending_reviews: number; creators_hired: number; activity: unknown[] };
    check("new brand dashboard is all zeros", ov.campaigns === 0 && ov.pending_reviews === 0 && ov.creators_hired === 0 && ov.activity.length === 0);
    const gl = await brand.c.from("brand_guidelines").select("id");
    check("new brand has no guidelines", (gl.data?.length ?? -1) === 0);

    console.log("\n▸ Campaign Studio data: guidelines + published brief");
    const g = await brand.c.from("brand_guidelines").insert({ brand_id: brand.id, name: "WS Test DNA", primary_colors: ["#D79706"], secondary_colors: ["#1A1A1A"], fonts: ["Inter"], visual_style: "Bold yellow, studio light." }).select("id, version").single();
    check("brand saves guidelines", !g.error && g.data?.version === 1, g.error?.message);
    const gUpd = await brand.c.from("brand_guidelines").update({ tone_of_voice: "Bright and direct" }).eq("id", g.data!.id).select("version").single();
    check("editing guidelines bumps the version", gUpd.data?.version === 2);
    const foreignG = await orbitone.c.from("brand_guidelines").select("id").eq("id", g.data!.id);
    check("another brand can't read these guidelines", (foreignG.data?.length ?? 0) === 0);
    const camp = await brand.c.from("campaigns").insert({
      brand_id: brand.id, title: "WS acceptance campaign", description: "A test brief for the workspace acceptance flow.", status: "draft",
      aspect_ratios: ["4:5"], usage_rights: ["organic_social"], currency: "USD", ai_disclosure_required: true, guideline_id: g.data!.id,
      ai_brief: { title: "x" }, suggested_tools: ["Midjourney"], source_idea: "secret idea text",
    }).select("id").single();
    check("brand creates a draft campaign", !camp.error, camp.error?.message);
    const campaignId = camp.data!.id as string;
    const stolenGuide = await orbitone.c.from("campaigns").update({ guideline_id: g.data!.id }).eq("brand_id", orbitone.id).select("id").limit(1);
    check("a brand can't attach another brand's guidelines", !!stolenGuide.error || (stolenGuide.data?.length ?? 0) === 0);
    const published = await brand.c.rpc("publish_campaign", { p_campaign: campaignId });
    check("publish via RPC (notifies matching creators)", !published.error && typeof published.data === "number", published.error?.message);
    const card = (await maya.c.rpc("get_campaign", { p_id: campaignId })).data as Record<string, unknown> | null;
    check("studio inputs (source idea) are hidden from other users", !!card && !("source_idea" in card));

    console.log("\n▸ Hire → offer accepted in chat → hire → fund project (demo escrow)");
    const direct = await brand.c.from("campaign_creators").insert({ campaign_id: campaignId, creator_id: creator.id, status: "completed" } as never);
    check("hires can't be inserted directly", !!direct.error);
    const directHire = await brand.c.rpc("hire_creator", { p_campaign: campaignId, p_creator: creator.id, p_amount: 1200, p_currency: "USD" });
    check("direct hire (client-supplied price) is rejected", !!directHire.error);
    const conv = (await brand.c.rpc("start_negotiation", { p_campaign: campaignId, p_creator: creator.id })).data as string;
    const offerTerms = { deliverables: "6 stills + 2 reels", deadline: null, usage_rights: ["organic_social"] };
    const offer = (await creator.c.rpc("send_offer", { p_conversation: conv, p_price: 1200, p_terms: offerTerms })).data as string;
    const agreement = await brand.c.rpc("accept_offer", { p_message: offer });
    check("brand accepts the creator's price — that's the agreement", !agreement.error && !!agreement.data, agreement.error?.message);
    const hire = await brand.c.rpc("hire_creator", { p_proposal: agreement.data as string });
    check("brand hires at once from the agreement", !hire.error && !!hire.data, hire.error?.message);
    const projectId = hire.data as string;
    const esc = await creator.c.from("escrow_payments").select("status, amount, platform_fee").eq("campaign_creator_id", projectId).single();
    check("creator sees the pending (unfunded) escrow", esc.data?.status === "unfunded" && esc.data.amount === 1200 && esc.data.platform_fee === 96);
    const waiting = (await creator.c.from("campaign_creators").select("status").eq("id", projectId).single()).data;
    check("hire waits for funding", waiting?.status === "awaiting_funding");
    check("creator can't start work before funding", !!(await creator.c.rpc("create_submission", { p_project: projectId })).error);
    const fund = await brand.c.rpc("fund_escrow", { p_project: projectId });
    check("brand funds the project (demo)", !fund.error, fund.error?.message);
    check("funded → in progress", (await creator.c.from("campaign_creators").select("status").eq("id", projectId).single()).data?.status === "in_progress");

    console.log("\n▸ Creator submits v1 (private upload → watermarked preview via API)");
    const s1 = (await creator.c.rpc("create_submission", { p_project: projectId })).data as string;
    check("draft v1 created", !!s1);
    const orig1 = await image("#D79706");
    const p1 = `${creator.id}/${s1}/original-1.jpg`;
    const up1 = await creator.c.storage.from("submissions").upload(p1, orig1, { contentType: "image/jpeg" });
    check("creator uploads the original to their private draft folder", !up1.error, up1.error?.message);
    const evil = await maya.c.storage.from("submissions").upload(`${creator.id}/${s1}/evil.jpg`, orig1, { contentType: "image/jpeg" });
    check("another user can't write into that folder", !!evil.error);
    const evil2 = await maya.c.storage.from("submissions").upload(`${maya.id}/${s1}/evil.jpg`, orig1, { contentType: "image/jpeg" });
    check("…nor into someone else's submission from their own folder", !!evil2.error);
    check("brand calling the creator files API → 403", (await api(`/api/submissions/${s1}/files`, { body: { kind: "upload", path: p1, name: "x.jpg", mime: "image/jpeg", position: 0 }, cookie: brand.cookie })).status === 403);
    check("other creator registering files on this draft → 404", (await api(`/api/submissions/${s1}/files`, { body: { kind: "upload", path: p1, name: "x.jpg", mime: "image/jpeg", position: 0 }, cookie: maya.cookie })).status === 404);
    const f1res = await api(`/api/submissions/${s1}/files`, { body: { kind: "upload", path: p1, name: "hero-v1.jpg", mime: "image/jpeg", position: 0 }, cookie: creator.cookie });
    const f1 = (await f1res.json()) as { file?: { id: string; preview_kind: string; sha256: string; preview_path: string; storage_path: string; palette: string[] } };
    check("server builds a watermarked preview", f1res.status === 200 && f1.file?.preview_kind === "image_watermark" && !!f1.file.preview_path, `${f1res.status}`);
    check("server records the SHA-256 of the original", f1.file?.sha256 === sha(orig1));
    check("palette extracted deterministically", (f1.file?.palette ?? []).some((h) => h.toUpperCase().startsWith("#D")), JSON.stringify(f1.file?.palette));
    const link = await api(`/api/submissions/${s1}/files`, { body: { kind: "link", url: "https://vimeo.com/76979871", position: 1 }, cookie: creator.cookie });
    check("creator can add a link", link.status === 200);
    const noDecl = await api(`/api/submissions/${s1}/submit`, { body: { notes: "v1", tools_used: ["Midjourney"], workflow_notes: null, ai_generated_declared: false, commercial_terms_accepted: true }, cookie: creator.cookie });
    check("submit without the AI declaration → 400", noDecl.status === 400);
    const sub1 = await api(`/api/submissions/${s1}/submit`, { body: { notes: "First pass", tools_used: ["Midjourney", "Runway"], workflow_notes: "MJ → Runway", ai_generated_declared: true, commercial_terms_accepted: true }, cookie: creator.cookie });
    check("creator submits v1", sub1.status === 200, `${sub1.status} ${await sub1.clone().text()}`);
    check("brand calling the submit API → 403", (await api(`/api/submissions/${s1}/submit`, { body: {}, cookie: brand.cookie })).status === 403);

    console.log("\n▸ Brand sees a watermarked preview + AI results (background job)");
    const review1 = await waitForReview(brand.c, s1);
    check("AI review finished in the background", !!review1, "timed out");
    if (review1) {
      const checks = review1.checks as Record<string, { status: string; method: string }>;
      check(`AI review status ${review1.status}${review1.model_name ? ` via ${review1.model_name}` : ""}`, review1.status === "done" || review1.status === "failed", review1.error ?? "");
      if (review1.status === "failed") console.log(`    (AI-assisted part failed: ${review1.error}; measured checks still ran)`);
      check("colour check is deterministic and passes for on-brand colour", checks.colors?.method === "deterministic" && checks.colors.status === "pass", JSON.stringify(checks.colors?.status));
      check("disclosure check compares declaration vs requirement", checks.ai_disclosure?.method === "declaration" && checks.ai_disclosure.status === "pass");
      check("logo/style/typography are labelled AI-assisted", ["logo", "visual_style", "typography"].every((k) => checks[k]?.method === "ai_assisted"));
      check("brand-match score is derived from the checklist", review1.brand_match_score === null || (review1.brand_match_score >= 0 && review1.brand_match_score <= 100));
    }
    check("creator can't read the AI review", ((await creator.c.from("ai_review_results").select("status").eq("submission_id", s1)).data?.length ?? 0) === 0);
    const prevSigned = await brand.c.storage.from("submission-previews").createSignedUrl(f1.file!.preview_path, 60);
    check("brand can sign the watermarked preview", !prevSigned.error && !!prevSigned.data?.signedUrl);
    const prevRes = prevSigned.data ? await fetch(prevSigned.data.signedUrl) : null;
    const prevBuf = prevRes ? Buffer.from(await prevRes.arrayBuffer()) : Buffer.alloc(0);
    check("preview is a JPEG that differs from the original", prevRes?.ok === true && sha(prevBuf) !== sha(orig1));
    const origEarly = await brand.c.storage.from("submissions").createSignedUrl(f1.file!.storage_path, 60);
    check("brand can't get the original before approval + funding", !!origEarly.error);
    const foreignPrev = await orbitone.c.storage.from("submission-previews").createSignedUrl(f1.file!.preview_path, 60);
    check("another brand can't get even the preview", !!foreignPrev.error);
    check("another brand can't see the submission", ((await orbitone.c.from("submissions").select("id").eq("id", s1)).data?.length ?? 0) === 0);
    check("another creator can't open the project", (await maya.c.rpc("get_project", { p_project: projectId })).data === null);
    check("creator can't review their own work", !!(await creator.c.rpc("review_submission", { p_submission: s1, p_decision: "approved" })).error);
    check("another brand can't fund this escrow", !!(await orbitone.c.rpc("fund_escrow", { p_project: projectId })).error);

    console.log("\n▸ Revision → v2 → approve");
    check("revision needs feedback", !!(await brand.c.rpc("review_submission", { p_submission: s1, p_decision: "revision_requested", p_feedback: "" })).error);
    const rev = await brand.c.rpc("review_submission", { p_submission: s1, p_decision: "revision_requested", p_feedback: "Make the yellow warmer, please." });
    check("brand requests a revision", !rev.error, rev.error?.message);
    const s2 = (await creator.c.rpc("create_submission", { p_project: projectId })).data as string;
    const orig2 = await image("#E0A010");
    const p2 = `${creator.id}/${s2}/original-2.jpg`;
    await creator.c.storage.from("submissions").upload(p2, orig2, { contentType: "image/jpeg" });
    const f2 = (await (await api(`/api/submissions/${s2}/files`, { body: { kind: "upload", path: p2, name: "hero-v2.jpg", mime: "image/jpeg", position: 0 }, cookie: creator.cookie })).json()) as { file: { storage_path: string; sha256: string } };
    const sub2 = await api(`/api/submissions/${s2}/submit`, { body: { notes: "Warmer", tools_used: ["Midjourney"], workflow_notes: null, ai_generated_declared: true, commercial_terms_accepted: true }, cookie: creator.cookie });
    check("creator resubmits v2", sub2.status === 200);
    const proj2 = (await creator.c.rpc("get_project", { p_project: projectId })).data as { status: string; submissions: { version: number }[] };
    check("project is 'resubmitted' with 2 versions", proj2.status === "resubmitted" && proj2.submissions.length === 2);
    check("old version can't be approved", !!(await brand.c.rpc("review_submission", { p_submission: s1, p_decision: "approved" })).error);
    const appr = await brand.c.rpc("review_submission", { p_submission: s2, p_decision: "approved" });
    check("brand approves v2", !appr.error, appr.error?.message);

    console.log("\n▸ Approved + funded → originals unlock → release → licence record");
    check("escrow is still held (funded) after approval", (await brand.c.from("escrow_payments").select("status").eq("campaign_creator_id", projectId).single()).data?.status === "funded");
    const orig = await brand.c.storage.from("submissions").createSignedUrl(f2.file.storage_path, 60);
    const origBuf = orig.data ? Buffer.from(await (await fetch(orig.data.signedUrl)).arrayBuffer()) : Buffer.alloc(0);
    check("approved + funded → brand downloads the clean original", !orig.error && sha(origBuf) === f2.file.sha256);
    check("v1 original stays locked (not approved)", !!(await brand.c.storage.from("submissions").createSignedUrl(f1.file!.storage_path, 60)).error);
    check("creator can't release payment", (await api(`/api/projects/${projectId}/release`, { method: "POST", cookie: creator.cookie })).status === 403);
    const rel = await api(`/api/projects/${projectId}/release`, { method: "POST", cookie: brand.cookie });
    const relBody = (await rel.json()) as { certificate_id?: string; pdf?: boolean };
    check("brand releases payment → licence record issued", rel.status === 200 && /^CRT-/.test(relBody.certificate_id ?? "") && relBody.pdf === true, JSON.stringify(relBody));
    const code = relBody.certificate_id!;
    const pdf = await api(`/api/certificates/${code}`, { cookie: creator.cookie });
    const pdfBuf = Buffer.from(await pdf.arrayBuffer());
    check("creator downloads the licence PDF", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdfBuf.subarray(0, 4).toString() === "%PDF");
    check("anonymous certificate PDF → 401", (await api(`/api/certificates/${code}`)).status === 401);
    check("another brand can't download it → 404", (await api(`/api/certificates/${code}`, { cookie: orbitone.cookie })).status === 404);
    const verify = await fetch(`${APP}/verify/${code}`, { redirect: "manual" });
    const verifyHtml = await verify.text();
    check("public /verify page confirms the record (no login)", verify.status === 200 && verifyHtml.includes(code) && verifyHtml.includes(f2.file.sha256));
    check("verify page doesn't leak the fee", !verifyHtml.includes("1,200") && !verifyHtml.includes("1200"));
    const bogus = await fetch(`${APP}/verify/CRT-0000-0000-0000`);
    check("unknown certificate shows 'No record found'", bogus.status === 200 && (await bogus.text()).includes("No record found"));

    console.log("\n▸ Creator sees the payment + earnings");
    const done = (await creator.c.rpc("get_project", { p_project: projectId })).data as { status: string; payment_status: string; escrow: { status: string }; certificate_id: string; payments: unknown[] };
    check("project completed, paid, escrow released", done.status === "completed" && done.payment_status === "paid" && done.escrow.status === "released" && done.certificate_id === code);
    check("ledger has created → funded → released", done.payments.length === 3);
    const today = new Date().toISOString().slice(0, 10);
    const career = (await creator.c.rpc("dashboard_career", { p_creator: creator.id, p_from: today, p_to: today })).data as { earned_in_range: number; completed: number };
    check("creator dashboard earnings updated", Number(career.earned_in_range) === 1200 && career.completed === 1, JSON.stringify(career));
    const receipt = await api(`/api/projects/${projectId}/receipt`, { cookie: creator.cookie });
    check("creator downloads the earnings receipt (PDF)", receipt.status === 200 && receipt.headers.get("content-type") === "application/pdf");
    check("another creator can't get the receipt", (await api(`/api/projects/${projectId}/receipt`, { cookie: maya.cookie })).status === 404);
    const notes = await creator.c.from("notifications").select("type, data").in("type", ["project", "payment"]);
    const events = new Set((notes.data ?? []).map((n) => (n.data as { event: string }).event));
    // The hire itself arrives as 'awaiting_funding' ("Hired for … waiting for the brand to fund"), then 'in_progress' once funded
    check("creator was notified of every brand action", ["awaiting_funding", "in_progress", "revision_requested", "approved", "funded", "released", "completed"].every((e) => events.has(e)), [...events].join(","));
    const brandNotes = await brand.c.from("notifications").select("data").eq("type", "project");
    check("brand was notified of submissions", (brandNotes.data ?? []).some((n) => (n.data as { event: string }).event === "submitted") && (brandNotes.data ?? []).some((n) => (n.data as { event: string }).event === "resubmitted"));
    const sys = await creator.c.from("messages").select("body").eq("kind", "system");
    check("system messages posted in their conversation", (sys.data?.length ?? 0) >= 8, String(sys.data?.length));
    const forged = await creator.c.from("messages").insert({ conversation_id: "00000000-0000-0000-0000-000000000000", sender_id: creator.id, body: "x", kind: "system" } as never);
    check("clients can't forge system messages", !!forged.error);
    const ledgerEdit = await admin.from("payment_events").update({ note: "tamper" }).eq("amount", 1200).select("id");
    check("payment ledger is append-only (even for the service role)", !!ledgerEdit.error);
    const review = await creator.c.from("project_reviews").insert({ project_id: projectId, author_id: creator.id, subject_id: brand.id, rating: 5, body: "Great brief" });
    check("creator reviews the brand after completion", !review.error, review.error?.message);
    const fakeReview = await maya.c.from("project_reviews").insert({ project_id: projectId, author_id: maya.id, subject_id: brand.id, rating: 1 });
    check("outsiders can't review the project", !!fakeReview.error);

    console.log("\n▸ 48-hour sprint closes at its deadline (enforced server-side)");
    const sprint = await brand.c.from("campaigns").insert({
      brand_id: brand.id, title: "WS sprint", description: "A 48 hour sprint for the acceptance test.", status: "active",
      is_sprint: true, budget_min: 500, budget_max: 500, currency: "USD", aspect_ratios: ["9:16"], usage_rights: ["organic_social"],
    }).select("id, sprint_deadline").single();
    check("sprint deadline defaults to 48h", !sprint.error && Math.abs(new Date(sprint.data!.sprint_deadline).getTime() - Date.now() - 48 * 3600e3) < 5 * 60e3, sprint.error?.message);
    check("brand can't extend the sprint", !!(await brand.c.from("campaigns").update({ sprint_deadline: new Date(Date.now() + 70 * 3600e3).toISOString() }).eq("id", sprint.data!.id)).error);
    await creator.c.from("campaign_applications").insert({ campaign_id: sprint.data!.id, creator_id: creator.id, pitch: "Fast loops, on brand, delivered tonight." });
    const sp = await creator.c.from("campaign_creators").select("id, status").eq("campaign_id", sprint.data!.id).single();
    check("applying opens a sprint project", sp.data?.status === "applied");
    const ss = (await creator.c.rpc("create_submission", { p_project: sp.data!.id })).data as string;
    const sprintPath = `${creator.id}/${ss}/sprint.jpg`;
    await creator.c.storage.from("submissions").upload(sprintPath, await image("#D79706", 1080, 1920), { contentType: "image/jpeg" });
    await api(`/api/submissions/${ss}/files`, { body: { kind: "upload", path: sprintPath, name: "sprint.jpg", mime: "image/jpeg", position: 0 }, cookie: creator.cookie });
    await admin.from("campaigns").update({ sprint_deadline: new Date(Date.now() - 60_000).toISOString() }).eq("id", sprint.data!.id); // time passes
    const late = await api(`/api/submissions/${ss}/submit`, { body: { notes: null, tools_used: [], workflow_notes: null, ai_generated_declared: true, commercial_terms_accepted: true }, cookie: creator.cookie });
    const lateBody = await late.text();
    check("late sprint submission rejected by the server", late.status === 400 && /sprint closed/i.test(lateBody), `${late.status} ${lateBody}`);
    check("late applications rejected", !!(await maya.c.from("campaign_applications").insert({ campaign_id: sprint.data!.id, creator_id: maya.id, pitch: "Too late but trying anyway" })).error);
    const opps = (await maya.c.rpc("get_opportunities", { p_tab: "for_you", p_limit: 40, p_offset: 0 })).data as { campaign: { id: string } }[];
    check("closed sprint disappears from Opportunities", !opps.some((o) => o.campaign.id === sprint.data!.id));

    console.log("\n▸ Demo data stays in demo accounts");
    const demoIds = new Set<string>();
    for (let page = 1; ; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      data.users.filter((u) => u.email?.endsWith("@demo.creatora.ai")).forEach((u) => demoIds.add(u.id));
      if (data.users.length < 1000) break;
    }
    const seededGuides = await admin.from("brand_guidelines").select("brand_id").in("name", ["Atelier Nova — Brand DNA", "Orbitone — Product language", "Tidewell — Sunny & sparkling"]);
    check("seeded guidelines belong to demo brands only", (seededGuides.data ?? []).length === 3 && seededGuides.data!.every((r) => demoIds.has(r.brand_id)));
    // Seeded licences are the seed's own rows (its deterministic submission ids). Licences issued through the app may
    // link a demo brand with a real creator — real people can work with the demo brands — so "demo brand" isn't "seeded".
    const seededSubmissions = ["sofia", "diego"].map((c) => seedId(`history-sub-atelier-holiday-${c}`));
    const seededCerts = (await admin.from("ip_certificates").select("brand_id, creator_id").in("submission_id", seededSubmissions)).data ?? [];
    check("seeded licence records only link demo brands with demo creators", seededCerts.length >= 1 && seededCerts.every((c) => demoIds.has(c.brand_id) && demoIds.has(c.creator_id)),
      `${seededCerts.length} seeded`);
    // Every licence, seeded or issued in the app, names the project's creator, its brief and that brief's brand
    const certs = (await admin.from("ip_certificates").select("brand_id, creator_id, campaign_id, project:campaign_creators!inner(creator_id, campaign_id), brief:campaigns!inner(brand_id)")).data ?? [];
    const one = <T,>(x: T | T[]) => (Array.isArray(x) ? x[0] : x);
    check("every licence record matches its project, brief and brand", certs.length >= 1 && certs.every((c) =>
      one(c.project).creator_id === c.creator_id && one(c.project).campaign_id === c.campaign_id && one(c.brief).brand_id === c.brand_id), `${certs.length} licences`);
  } finally {
    for (const id of created) {
      for (const bucket of ["submissions", "submission-previews"]) {
        const { data: subs } = await admin.storage.from(bucket).list(id, { limit: 100 });
        for (const s of subs ?? []) {
          const { data: files } = await admin.storage.from(bucket).list(`${id}/${s.name}`, { limit: 200 });
          const nested = await admin.storage.from(bucket).list(`${id}/${s.name}/analysis`, { limit: 200 });
          await admin.storage.from(bucket).remove([
            ...(files ?? []).filter((f) => f.id).map((f) => `${id}/${s.name}/${f.name}`),
            ...(nested.data ?? []).map((f) => `${id}/${s.name}/analysis/${f.name}`),
          ]);
        }
      }
      const { data: certs } = await admin.from("ip_certificates").select("pdf_path").or(`brand_id.eq.${id},creator_id.eq.${id}`);
      const pdfs = (certs ?? []).map((c) => c.pdf_path).filter((p): p is string => !!p);
      if (pdfs.length) await admin.storage.from("certificates").remove(pdfs);
      await admin.from("conversations").delete().like("dm_key", `%${id}%`);
      await admin.auth.admin.deleteUser(id);
    }
    console.log("\n  (cleaned up the throwaway accounts, their files and certificates)");
  }
  console.log(`\n${failures ? "✗" : "✓"} ${passes} passed, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
