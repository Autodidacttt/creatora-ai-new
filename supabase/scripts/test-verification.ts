// End-to-end checks for account verification (0026) against a running app (APP_URL, default http://localhost:3000)
// in DEMO modes (OTP shown in the response, email not sent, AI contact discovery off). Throwaway accounts only;
// they — and their verification rows, ID images and reports — are deleted afterwards.
// Usage: npm run test:verification
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import sharp from "sharp";
import { requireEnv } from "./env";
import { DEMO_PASSWORD } from "../seed/data/accounts";
import { mockIdentityApiKey } from "../../src/lib/verification/settings";
import { pepperedHash } from "../../src/lib/verification/crypto";

const URL_ = requireEnv("SUPABASE_URL");
const PUB = requireEnv("SUPABASE_PUBLISHABLE_KEY");
const SECRET = requireEnv("SUPABASE_SECRET_KEY");
const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

let passes = 0, failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passes++; else failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
interface S { c: SupabaseClient; id: string; cookie: string; ip: string }
async function signIn(email: string, password: string): Promise<S> {
  const c = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  const jar = new Map<string, string>();
  const ssr = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
  await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  // A distinct client IP per account (locally the header passes through; on Vercel the edge sets it)
  return { c, id: data.user.id, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; "), ip: `10.${rnd(250)}.${rnd(250)}.${rnd(250)}` };
}
const rnd = (n: number) => 1 + Math.floor(Math.random() * n);
const call = async (path: string, s: S | null, init: { method?: string; json?: unknown; form?: FormData; headers?: Record<string, string> } = {}) => {
  const res = await fetch(APP + path, {
    method: init.method ?? (init.json !== undefined || init.form ? "POST" : "GET"),
    headers: { ...(init.json !== undefined ? { "content-type": "application/json" } : {}), ...(s ? { cookie: s.cookie, "x-forwarded-for": s.ip } : {}), ...init.headers },
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    redirect: "manual",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
};
const phoneNo = () => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
async function jpeg(label: string) {
  return sharp({ create: { width: 320, height: 200, channels: 3, background: "#e9e2d5" } })
    .composite([{ input: Buffer.from(`<svg width="320" height="200"><text x="12" y="40" font-size="20">${label}</text></svg>`) }]).jpeg().toBuffer();
}
const verifyPhone = async (s: S, phone: string) => {
  const st = await call("/api/verification/phone/start", s, { json: { phone } });
  if (st.status !== 200) return st;
  return call("/api/verification/phone/check", s, { json: { challenge_id: st.json.challenge_id, code: st.json.demo_code } });
};
const status = async (s: S) => (await call("/api/verification/status", s)).json as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function main() {
  if (!(await fetch(APP, { redirect: "manual" }).catch(() => null))) throw new Error(`App isn't reachable at ${APP}`);
  const stamp = Date.now();
  const pw = `Vf-${stamp}-Aa1!`;
  const created: string[] = [];
  const mk = async (tag: string, role: "creator" | "brand", meta: Record<string, string> = {}) => {
    const email = `vf-${tag}-${stamp}@example.com`;
    const r = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { role, display_name: `VF ${tag}`, ...meta } });
    if (r.error || !r.data.user) throw new Error(r.error?.message);
    created.push(r.data.user.id);
    await admin.from("profiles").update({ onboarded: true }).eq("id", r.data.user.id);
    return signIn(email, pw);
  };
  try {
    const creator = await mk("creator", "creator");
    const creator2 = await mk("creator2", "creator");
    const recruiter = await mk("recruiter", "brand", { brand_type: "individual" });
    const company = await mk("company", "brand", { brand_type: "company" });
    const company2 = await mk("company2", "brand", { brand_type: "company" });
    const company3 = await mk("company3", "brand", { brand_type: "company" });
    const untyped = await mk("untyped", "brand");
    const adminS = await signIn("admin@demo.creatora.ai", DEMO_PASSWORD);

    console.log(`\n▸ Phone OTP (${APP}, demo mode)`);
    check("invalid number → 400", (await call("/api/verification/phone/start", creator, { json: { phone: "12345" } })).status === 400);
    const phoneA = phoneNo();
    const s1 = await call("/api/verification/phone/start", creator, { json: { phone: phoneA } });
    check("code issued; demo mode shows it, labelled", s1.status === 200 && /^\d{6}$/.test(String(s1.json.demo_code)) && s1.json.demo_label === "Demo OTP, no SMS sent", JSON.stringify(s1.json).slice(0, 160));
    check("number normalized + masked", typeof s1.json.masked === "string" && String(s1.json.masked).endsWith(phoneA.slice(-4)) && String(s1.json.masked).includes("•"));
    check("resend inside the cooldown → 429", (await call("/api/verification/phone/start", creator, { json: { phone: phoneA } })).status === 429);
    const wrong = await call("/api/verification/phone/check", creator, { json: { challenge_id: s1.json.challenge_id, code: s1.json.demo_code === "000000" ? "111111" : "000000" } });
    check("wrong code → 400, 4 attempts left", wrong.status === 400 && wrong.json.attempts_left === 4, JSON.stringify(wrong.json));
    const ch = (await admin.from("phone_otp_challenges").select("code_hash, phone_hash, phone_cipher").eq("id", String(s1.json.challenge_id)).single()).data!;
    check("code stored only as a hash; number hashed + encrypted", !!ch.code_hash && ch.code_hash.length === 64 && !JSON.stringify(ch).includes(String(s1.json.demo_code)) && !ch.phone_cipher.includes(phoneA.slice(1)));
    const right = await call("/api/verification/phone/check", creator, { json: { challenge_id: s1.json.challenge_id, code: s1.json.demo_code } });
    check("right code → Phone Verified", right.status === 200 && (await status(creator)).phone?.verified === true, JSON.stringify(right.json));
    check("a used code can't be reused", (await call("/api/verification/phone/check", creator, { json: { challenge_id: s1.json.challenge_id, code: s1.json.demo_code } })).status === 409);
    // Duplicate number across a creator AND a brand
    const dup = await call("/api/verification/phone/start", recruiter, { json: { phone: phoneA.replace("+91", "+91 ").replace(/(\d{5})(\d{5})$/, "$1 $2") } });
    check("same number on another account (brand) → rejected with a clear message", dup.status === 409 && /another Creatora account/.test(String(dup.json.error)), JSON.stringify(dup.json));
    const race = await admin.rpc("verification_record_phone", { p_user: recruiter.id, p_hash: pepperedHash("phone", phoneA), p_masked: "x", p_cipher: "x", p_method: "demo" });
    check("database constraint rejects the duplicate even in a race", !!race.error && race.error.code === "23505", race.error?.message);
    // Expiry
    const s2 = await call("/api/verification/phone/start", creator2, { json: { phone: phoneNo() } });
    await admin.from("phone_otp_challenges").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", String(s2.json.challenge_id));
    check("expired code → 410", (await call("/api/verification/phone/check", creator2, { json: { challenge_id: s2.json.challenge_id, code: s2.json.demo_code } })).status === 410);
    // Attempt limit
    const s3 = await call("/api/verification/phone/start", company3, { json: { phone: phoneNo() } });
    const bad = s3.json.demo_code === "000000" ? "111111" : "000000";
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await call("/api/verification/phone/check", company3, { json: { challenge_id: s3.json.challenge_id, code: bad } })).status;
    check("5 wrong codes → locked (429)", last === 429);
    check("…even the right code is refused afterwards", (await call("/api/verification/phone/check", company3, { json: { challenge_id: s3.json.challenge_id, code: s3.json.demo_code } })).status === 429);

    console.log("\n▸ Mock government-ID API");
    const mockKey = mockIdentityApiKey();
    check("no API key → 401", (await call("/api/mock-identity/verify", null, { json: { name: "Maya Okafor", id_number: "DEMO-100008", dob: "1997-12-09" } })).status === 401);
    const m1 = await call("/api/mock-identity/verify", null, { json: { name: "  maya OKAFOR ", id_number: "demo 100008", dob: "1997-12-09" }, headers: { "x-api-key": mockKey } });
    check("fictional identity matches with normalized name / number", m1.json.result === "Identity Verified" && m1.json.simulated === true, JSON.stringify(m1.json));
    const m2 = await call("/api/mock-identity/verify", null, { json: { name: "Maya Okafor", id_number: "DEMO-100008", dob: "1997-12-10" }, headers: { "x-api-key": mockKey } });
    check("mismatch → 'Identity Not Verified' (no hint which field)", m2.json.result === "Identity Not Verified" && Object.keys(m2.json).sort().join() === "notice,result,simulated", JSON.stringify(m2.json));

    console.log("\n▸ ID verification → mock check → admin decision → badge");
    const idForm = async (name: string, id: string, dob: string, file?: Buffer, mime = "image/jpeg") => {
      const f = new FormData();
      f.append("full_name", name); f.append("id_type", "national_id"); f.append("id_number", id); f.append("dob", dob); f.append("consent", "true");
      if (file) f.append("id_image", new Blob([new Uint8Array(file)], { type: mime }), "id.jpg");
      return f;
    };
    check("ID before phone verification → refused", (await call("/api/verification/identity", creator2, { form: await idForm("Maya Okafor", "DEMO-100008", "1997-12-09", await jpeg("ID")) })).status === 400);
    check("a non-image file → 400", (await call("/api/verification/identity", creator, { form: await idForm("Maya Okafor", "DEMO-100008", "1997-12-09", Buffer.from("not an image"), "image/jpeg") })).status === 400);
    const sub = await call("/api/verification/identity", creator, { form: await idForm("Maya Okafor", "DEMO-100008", "1997-12-09", await jpeg("DEMO ID")) });
    check("ID submitted → pending", sub.status === 200 && sub.json.status === "pending", JSON.stringify(sub.json));
    check("second submission while pending → 409", (await call("/api/verification/identity", creator, { form: await idForm("Maya Okafor", "DEMO-100008", "1997-12-09", await jpeg("ID")) })).status === 409);
    const row = (await admin.from("identity_verifications").select("*").eq("id", String(sub.json.id)).single()).data!;
    check("ID number stored only as hash + last 4", row.id_number_hash.length === 64 && row.id_last4 === "0008" && !JSON.stringify(row).includes("DEMO-100008") && !JSON.stringify(row).includes("DEMO100008"));
    let mock: string | undefined;
    for (let i = 0; i < 20 && !mock; i++) { await new Promise((r) => setTimeout(r, 500)); mock = (await status(creator)).identity?.mock_result; }
    check("advisory mock check stored ('Identity Verified')", mock === "Identity Verified", String(mock));
    // Private ID image
    check("owner can't open the ID image (admin route)", (await call(`/api/admin/verifications/identity/${sub.json.id}/image`, creator)).status === 403);
    check("another brand can't either", (await call(`/api/admin/verifications/identity/${sub.json.id}/image`, company)).status === 403);
    check("no client read on the bucket (owner's own token)", !!(await creator.c.storage.from("identity-documents").createSignedUrl(row.id_image_path, 60)).error);
    check("…nor a public URL", (await fetch(`${URL_}/storage/v1/object/public/identity-documents/${row.id_image_path}`)).status >= 400);
    // Admin
    const list = await adminS.c.rpc("admin_list_identity_verifications", { p_kind: "creator", p_status: "pending", p_query: "Maya Okafor", p_limit: 50, p_offset: 0 });
    check("admin queue lists it (Creators tab)", (list.data ?? []).some((r: { item: { id: string } }) => r.item.id === sub.json.id), list.error?.message);
    const img = await call(`/api/admin/verifications/identity/${sub.json.id}/image`, adminS);
    check("admin opens the ID image via a short-lived signed URL", img.status === 200 && (await fetch(String(img.json.url))).ok, JSON.stringify(img.json).slice(0, 120));
    const ph = await call(`/api/admin/verifications/identity/${sub.json.id}/phone`, adminS);
    check("admin sees the phone number", ph.status === 200 && ph.json.phone === phoneA);
    const logs = (await admin.from("audit_logs").select("action").eq("target_id", String(sub.json.id))).data ?? [];
    check("ID image + phone views are audit-logged", ["view_id_image", "view_phone"].every((a) => logs.some((l) => l.action === a)));
    check("reject without a reason → refused", !!(await adminS.c.rpc("admin_decide_identity", { p_id: sub.json.id, p_decision: "rejected", p_reason: "" })).error);
    await adminS.c.rpc("admin_decide_identity", { p_id: sub.json.id, p_decision: "rejected", p_reason: "Photo is blurry, please retake" });
    const afterReject = await status(creator);
    check("rejected: user sees the reason and can resubmit", afterReject.identity?.status === "rejected" && /blurry/.test(afterReject.identity?.reason) && afterReject.identity_attempts_left === 2);
    const sub2 = await call("/api/verification/identity", creator, { form: await idForm("Maya Okafor", "DEMO-100008", "1997-12-09", await jpeg("DEMO ID 2")) });
    check("resubmission after a rejection is accepted", sub2.status === 200, JSON.stringify(sub2.json));
    await adminS.c.rpc("admin_decide_identity", { p_id: sub2.json.id, p_decision: "verified" });
    const badges = (await creator.c.rpc("trust_badges", { p_id: creator.id })).data as { phone_verified: boolean; identity_verified: boolean };
    check("verified → Phone Verified + Identity Verified badges", badges?.phone_verified && badges?.identity_verified, JSON.stringify(badges));
    const card = (await creator2.c.rpc("search_creators", { p_identity_verified: true, p_limit: 60 } as never)).data as { creator: { id: string } }[];
    check("search filter 'Identity verified' finds them", (card ?? []).some((c) => c.creator.id === creator.id));
    check("…and leaves unverified creators out", !(card ?? []).some((c) => c.creator.id === creator2.id));
    const notes = (await creator.c.from("notifications").select("data").eq("type", "verification")).data ?? [];
    check("notified on each change", ["phone_verified", "identity_pending", "identity_rejected", "identity_verified"].every((e) => notes.some((n) => (n.data as { event: string }).event === e)));
    // An admin without the permission
    const noPerm = await mk("noperm", "creator");
    await admin.from("profiles").update({ role: "admin" }).eq("id", noPerm.id);
    check("an admin without verify_creators can't see the queue", !!(await noPerm.c.rpc("admin_list_identity_verifications", { p_kind: "creator", p_status: null as unknown as string, p_query: null as unknown as string, p_limit: 5, p_offset: 0 })).error);

    console.log("\n▸ Brand types + gating");
    check("signup type stored (Individual Recruiter)", (await admin.from("brand_details").select("brand_type").eq("profile_id", recruiter.id).single()).data?.brand_type === "individual");
    check("signup type stored (Company)", (await admin.from("brand_details").select("brand_type").eq("profile_id", company.id).single()).data?.brand_type === "company");
    check("type can be chosen later (RPC)", !(await untyped.c.rpc("set_brand_type", { p_type: "company" })).error);
    check("brand can't set its own verified flag", !!(await recruiter.c.from("brand_details").update({ company_verified_at: new Date().toISOString() } as never).eq("profile_id", recruiter.id)).error);
    const draft = await recruiter.c.from("campaigns").insert({ brand_id: recruiter.id, title: "VF draft brief", description: "Drafts are allowed before verification", status: "draft", aspect_ratios: ["9:16"], usage_rights: ["organic_social"] }).select("id").single();
    check("unverified brand can create a draft", !draft.error, draft.error?.message);
    check("…but can't publish it", !!(await recruiter.c.rpc("publish_campaign", { p_campaign: draft.data!.id })).error);
    check("…nor insert an active brief directly", !!(await recruiter.c.from("campaigns").insert({ brand_id: recruiter.id, title: "VF active", description: "Direct insert as active", status: "active", aspect_ratios: ["9:16"] })).error);
    // Hiring is gated too: publish while briefly verified, then hire after the badge is removed
    await admin.from("profiles").update({ identity_verified_at: new Date().toISOString() }).eq("id", recruiter.id);
    check("verified recruiter can publish", !(await recruiter.c.rpc("publish_campaign", { p_campaign: draft.data!.id })).error);
    await admin.from("profiles").update({ identity_verified_at: null }).eq("id", recruiter.id);
    const conv = (await recruiter.c.rpc("start_negotiation", { p_campaign: draft.data!.id, p_creator: creator.id })).data as string;
    const offer = (await creator.c.rpc("send_offer", { p_conversation: conv, p_price: 500, p_terms: { deliverables: "1 reel", deadline: null, usage_rights: ["organic_social"] } })).data as string;
    const agreement = (await recruiter.c.rpc("accept_offer", { p_message: offer })).data as string;
    const hire = await recruiter.c.rpc("hire_creator", { p_proposal: agreement });
    check("unverified brand can't hire (RPC)", !!hire.error && /Verify your brand/.test(hire.error.message), hire.error?.message);
    check("status says can't operate", (await status(recruiter)).can_operate === false);
    check("grandfathered demo brand keeps working", ((await adminS.c.rpc("brand_can_operate", { p_brand: (await admin.from("profiles").select("id").eq("username", "ateliernova").maybeSingle()).data?.id ?? created[0] })).data) !== false);

    console.log("\n▸ Company verification: suggestion → invite → public approve");
    check("company form needs a verified phone", (await call("/api/verification/company", company, { json: { company_name: "Northpeak Studios", website: "northpeak.example", company_email: "ana@northpeak.example", address: "1 Demo Street", applicant_name: "Ana Demo", applicant_role: "Producer", relationship: "Employee" } })).status === 400);
    for (const s of [company, company2, untyped]) await verifyPhone(s, phoneNo());
    const cv = await call("/api/verification/company", company, { json: { company_name: "Northpeak Studios", website: "northpeak.example", company_email: "ana@northpeak.example", address: "1 Demo Street", industry: "Film", applicant_name: "Ana Demo", applicant_role: "Producer", relationship: "Employee since 2024" } });
    check("submitted → pending, deterministic domain match", cv.status === 200 && cv.json.domain_match === true && cv.json.free_mail === false, JSON.stringify(cv.json));
    check("status 'Company Verification Pending'", (await status(company)).company?.status === "pending");
    const free = await call("/api/verification/company", company2, { json: { company_name: "Northpeak Studios", website: "https://northpeak.example", company_email: "someone@gmail.com", address: "1 Demo Street", applicant_name: "Bob Demo", applicant_role: "Intern", relationship: "Freelancer" } });
    check("free-mail address flagged", free.json.free_mail === true && free.json.domain_match === false);
    const disc = await call(`/api/admin/verifications/company/${cv.json.id}/discover`, adminS, { json: {} });
    check("Find official contacts → demo directory (AI discovery off)", disc.status === 200 && disc.json.source === "demo_directory" && Number(disc.json.count) >= 1, JSON.stringify(disc.json));
    check("…not available to brands", (await call(`/api/admin/verifications/company/${cv.json.id}/discover`, company, { json: {} })).status === 403);
    const detail = (await adminS.c.rpc("admin_get_company_verification", { p_id: cv.json.id })).data as { suggestions: { id: string; public_business_email: string; source: string }[] };
    const sug = detail.suggestions[0];
    const inv = await call(`/api/admin/verifications/company/${cv.json.id}/invite`, adminS, { json: { suggestion_id: sug.id, name: "", role: "Legal", email: sug.public_business_email } });
    check("invitation created; demo mode returns the link (email not sent)", inv.status === 200 && inv.json.mode === "demo" && /\/verify-company\//.test(String(inv.json.link)), JSON.stringify(inv.json).slice(0, 160));
    const token = String(inv.json.link).split("/verify-company/")[1];
    const invRow = (await admin.from("company_invitations").select("token_hash").eq("company_verification_id", String(cv.json.id)).single()).data!;
    check("token stored only as a hash", invRow.token_hash.length === 64 && invRow.token_hash !== token);
    const page = await call(`/verify-company/${token}`, null);
    check("public page (no login) shows company, applicant and role", page.status === 200 && page.text.includes("Northpeak Studios") && page.text.includes("Ana Demo") && page.text.includes("Producer"));
    check("invalid token → not valid", (await call("/api/verify-company/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", null, { json: { decision: "approved" } })).status === 404);
    const ok1 = await call(`/api/verify-company/${token}`, null, { json: { decision: "approved", comment: "Yes, she works with us" } });
    check("contact approves → Verified Company", ok1.json.result === "approved" && (await status(company)).company_verified === true, JSON.stringify(ok1.json));
    check("single use (second answer doesn't change it)", (await call(`/api/verify-company/${token}`, null, { json: { decision: "rejected" } })).json.result === "approved");
    check("verified company can operate", (await status(company)).can_operate === true);

    console.log("\n▸ Company: contact rejects → admin report; no response → expires");
    const cv3 = await call("/api/verification/company", untyped, { json: { company_name: "Orbitone", website: "orbitone.example", company_email: "x@orbitone.example", address: "2 Demo Road", applicant_name: "Mallory Demo", applicant_role: "CEO", relationship: "Claims to be the CEO" } });
    const inv3 = await call(`/api/admin/verifications/company/${cv3.json.id}/invite`, adminS, { json: { suggestion_id: null, name: "", role: "Press", email: "press@orbitone.example" } });
    const tok3 = String(inv3.json.link).split("/verify-company/")[1];
    await call(`/api/verify-company/${tok3}`, null, { json: { decision: "rejected", comment: "We don't know this person" } });
    const c3 = (await adminS.c.rpc("admin_get_company_verification", { p_id: cv3.json.id })).data as { status: string; rejection_source: string };
    check("admin sees 'Verification Rejected / Potential Impersonation'", c3.status === "rejected" && c3.rejection_source === "company_contact");
    const rep = (await admin.from("reports").select("priority, reason").eq("target_id", untyped.id)).data ?? [];
    check("high-priority impersonation report created (no auto-suspension)", rep.some((r) => r.priority === "high" && r.reason === "impersonation")
      && (await admin.from("profiles").select("is_suspended").eq("id", untyped.id).single()).data?.is_suspended === false);
    const mine = await status(untyped);
    check("applicant sees a neutral 'rejected' (no impersonation wording)", mine.company?.status === "rejected" && mine.company?.reason === null);
    const cv2 = await call("/api/verification/company", company2, { json: { company_name: "Northpeak Studios", website: "https://northpeak.example", company_email: "bob@northpeak.example", address: "1 Demo Street", applicant_name: "Bob Demo", applicant_role: "Intern", relationship: "Freelancer" } });
    const cvId = cv2.status === 200 ? cv2.json.id : free.json.id;
    const inv2 = await call(`/api/admin/verifications/company/${cvId}/invite`, adminS, { json: { suggestion_id: null, name: "", role: "Legal", email: "legal@northpeak.example" } });
    const tok2 = String(inv2.json.link).split("/verify-company/")[1];
    await admin.from("company_invitations").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("token_hash", pepperedHash("invite", tok2));
    check("expired link → 'expired', verification stays pending", (await call(`/api/verify-company/${tok2}`, null, { json: { decision: "approved" } })).json.result === "expired"
      && (await status(company2)).company?.status === "pending");

    console.log("\n▸ Old tool / workflow verification is gone");
    const tool = (await admin.from("ai_tools").select("id").limit(1).single()).data!.id;
    check("can't request a tool verification any more", !!(await creator.c.from("verifications").insert({ creator_id: creator.id, type: "tool", tool_id: tool, title: "Old tool verification" })).error);
    const anyCard = ((await creator2.c.rpc("search_creators", { p_limit: 30 } as never)).data ?? []) as { creator: { tools: { verified?: boolean }[] } }[];
    check("no tool shows as verified on cards", anyCard.every((c) => c.creator.tools.every((t) => !t.verified)));

    console.log("\n▸ RLS: sensitive tables are server-only");
    for (const t of ["verified_phones", "phone_otp_challenges", "identity_verifications", "company_verifications", "company_invitations", "mock_identity_records", "admin_permissions"]) {
      const r = await creator.c.from(t as never).select("*").limit(1);
      check(`client can't read ${t}`, !!r.error || (r.data?.length ?? 0) === 0);
    }
    check("client can't call the server-only phone RPC", !!(await creator.c.rpc("verification_record_phone", { p_user: creator.id, p_hash: "x".repeat(64), p_masked: "x", p_cipher: "x", p_method: "demo" })).error);
    check("client can't set its own badge", !!(await creator2.c.from("profiles").update({ identity_verified_at: new Date().toISOString() } as never).eq("id", creator2.id)).error
      || !(await admin.from("profiles").select("identity_verified_at").eq("id", creator2.id).single()).data?.identity_verified_at);
  } finally {
    // Clean up: ID images, verifier notifications, impersonation reports, then the accounts (rows cascade)
    const imgs = (await admin.from("identity_verifications").select("id, id_image_path").in("user_id", created)).data ?? [];
    const paths = imgs.map((i) => i.id_image_path).filter((p): p is string => !!p);
    if (paths.length) await admin.storage.from("identity-documents").remove(paths);
    const companies = (await admin.from("company_verifications").select("id").in("brand_id", created)).data ?? [];
    const entities = [...imgs, ...companies].map((v) => v.id);
    if (entities.length) await admin.from("notifications").delete().eq("type", "verification").in("entity_id", entities);
    if (created.length) await admin.from("reports").delete().in("target_id", created);
    for (const id of created) await admin.auth.admin.deleteUser(id);
    console.log("\n  (cleaned up the throwaway accounts, their ID images, verification rows and reports)");
  }
  console.log(`\n${failures ? "✗" : "✓"} ${passes} passed, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
