// End-to-end checks for the AI Creator Finder against a running app (APP_URL, default http://localhost:3000):
// routes (validation, auth, search, lazy "why" + cache), ranking + pagination from SQL, fallback ranking, RLS.
// Throwaway brand accounts; their searches are deleted with them. Needs migration 0023.
// AI_FINDER_SEND_CREATOR_DATA must match the app's setting: "true" (after `npm run ai:embeddings`) checks semantic
// ranking and AI reasons; otherwise checks that no creator data reaches the AI (tags ranking, reasons unavailable).
// Usage: npm run test:ai-finder
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { requireEnv } from "./env";
import { DEMO_PASSWORD, creators } from "../seed/data/accounts";
import { AI_MATCH_WEIGHTS, creatorDataToAi } from "../../src/config/ai-match";

const URL_ = requireEnv("SUPABASE_URL");
const PUB = requireEnv("SUPABASE_PUBLISHABLE_KEY");
const SECRET = requireEnv("SUPABASE_SECRET_KEY");
const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

let passes = 0, failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passes++; else failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
interface Session { c: SupabaseClient; id: string; cookie: string }
async function signIn(email: string, password: string): Promise<Session> {
  const c = createClient(URL_, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  const jar = new Map<string, string>();
  const ssr = createServerClient(URL_, PUB, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (cs) => cs.forEach(({ name, value }) => jar.set(name, value)) } });
  await ssr.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return { c, id: data.user.id, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}
const post = (path: string, body: unknown, cookie?: string) =>
  fetch(APP + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

async function main() {
  const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
  if (!(await fetch(APP, { redirect: "manual" }).catch(() => null))) throw new Error(`App isn't reachable at ${APP}`);
  const sharing = creatorDataToAi();
  const stamp = Date.now();
  const pw = `Ai-${stamp}-Aa1!`;
  const created: string[] = [];
  const mkBrand = async (tag: string) => {
    const email = `ai-${tag}-${stamp}@example.com`;
    const r = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { role: "brand", display_name: `AI ${tag}` } });
    if (r.error || !r.data.user) throw new Error(r.error?.message);
    created.push(r.data.user.id);
    await admin.from("profiles").update({ onboarded: true }).eq("id", r.data.user.id);
    return signIn(email, pw);
  };
  try {
    const brand = await mkBrand("brand");
    const other = await mkBrand("other");
    const maya = await signIn(creators.find((c) => c.key === "maya")!.email, DEMO_PASSWORD);

    console.log(`\n▸ Validation, auth (${APP})`);
    check("idea too short → 400", (await post("/api/ai/match", { idea: "perfume" }, brand.cookie)).status === 400);
    check("idea too long → 400", (await post("/api/ai/match", { idea: "x".repeat(401) }, brand.cookie)).status === 400);
    check("signed out → 401", (await post("/api/ai/match", { idea: "a cinematic perfume ad with surreal visuals" })).status === 401);
    check("creators can't use the finder → 403", (await post("/api/ai/match", { idea: "a cinematic perfume ad with surreal visuals" }, maya.cookie)).status === 403);

    console.log("\n▸ Search → ranking (SQL) → pagination");
    const t0 = Date.now();
    const res = await post("/api/ai/match", { idea: "A cinematic 30-second perfume ad with surreal, dreamlike visuals" }, brand.cookie);
    const meta = (await res.json()) as { search_id: string; mode: string; notice: string | null; total: number; labels: string[] };
    check(`search answered in ${Date.now() - t0}ms`, res.status === 200 && !!meta.search_id, JSON.stringify(meta));
    if (sharing) check(`mode '${meta.mode}' (semantic when creator embeddings exist)`, meta.mode === "semantic" || (meta.mode === "tags" && !!meta.notice), JSON.stringify(meta));
    else check("creator data sharing off → tags ranking with a notice", meta.mode === "tags" && !!meta.notice, JSON.stringify(meta));
    const page1 = await brand.c.rpc("get_ai_match_results", { p_search: meta.search_id, p_limit: 4, p_offset: 0 });
    const page2 = await brand.c.rpc("get_ai_match_results", { p_search: meta.search_id, p_limit: 4, p_offset: 4 });
    const r1 = (page1.data ?? []) as { rank: number; score: number; breakdown: Record<string, unknown>; creator: { id: string; display_name: string } }[];
    const r2 = (page2.data ?? []) as typeof r1;
    check("ranks all available creators", meta.total >= 6, String(meta.total));
    check("scores 0-100, sorted, with breakdown", r1.length === 4 && r1.every((r, i) => r.score >= 0 && r.score <= 100 && (i === 0 || r1[i - 1].score >= r.score) && "experience" in r.breakdown),
      JSON.stringify(r1.map((r) => [r.creator.display_name, r.score])));
    check("pagination continues the ranking", r2.length > 0 && r2[0].rank === 5);
    if (meta.mode === "semantic") check("semantic similarity is part of the score", r1.some((r) => typeof r.breakdown.semantic === "number"));

    const top = r1[0].creator.id;
    if (!sharing) {
      console.log("\n▸ Creator data stays on the server (AI_FINDER_SEND_CREATOR_DATA off)");
      const w0 = await post(`/api/ai/match/${meta.search_id}/reason`, { creator_id: top }, brand.cookie);
      const off = (await w0.json()) as { disabled?: boolean };
      check("\"Why this creator?\" is switched off instead of sending the profile", w0.status === 503 && off.disabled === true, String(w0.status));
      const failedLogs = await admin.from("ai_job_logs").select("id", { count: "exact", head: true }).eq("job", "ai_match_reason").gte("created_at", new Date(t0 - 1000).toISOString());
      check("…without an AI call or a failed-job log", (failedLogs.count ?? 0) === 0, String(failedLogs.count));
      const vec = await admin.from("creator_embeddings").select("creator_id", { count: "exact", head: true }).not("embedding", "is", null).gte("embedded_at", new Date(t0 - 1000).toISOString());
      check("no creator was embedded by the search", (vec.count ?? 0) === 0, String(vec.count));
      check("the background refresh endpoint doesn't queue anything", ((await (await post("/api/ai/embeddings", {}, brand.cookie)).json()) as { queued: boolean }).queued === false);
    } else {
      console.log("\n▸ Why this creator? (lazy + cached)");
      const w1 = await post(`/api/ai/match/${meta.search_id}/reason`, { creator_id: top }, brand.cookie);
      const why = (await w1.json()) as { reasons?: string[]; gaps?: string[]; cached?: boolean; error?: string };
      check("first click generates 1-3 reasons", w1.status === 200 && !!why.reasons?.length && why.reasons.length <= 3 && why.cached === false, JSON.stringify(why));
      const w2 = (await (await post(`/api/ai/match/${meta.search_id}/reason`, { creator_id: top }, brand.cookie)).json()) as { cached?: boolean; reasons?: string[] };
      check("second click is served from the cache (no AI call)", w2.cached === true && JSON.stringify(w2.reasons) === JSON.stringify(why.reasons));
      check("another brand can't get reasons for this search", (await post(`/api/ai/match/${meta.search_id}/reason`, { creator_id: top }, other.cookie)).status === 404);
      const logs = await admin.from("ai_job_logs").select("job, status").in("job", ["ai_match", "ai_match_reason"]).gte("created_at", new Date(t0 - 1000).toISOString());
      check("AI jobs are logged", (logs.data ?? []).some((l) => l.job === "ai_match") && (logs.data ?? []).some((l) => l.job === "ai_match_reason"));
    }

    console.log("\n▸ RLS: searches are private, embeddings never exposed");
    check("another brand can't read the search", ((await other.c.from("ai_match_searches").select("id").eq("id", meta.search_id)).data?.length ?? 0) === 0);
    check("…or its results", ((await other.c.rpc("get_ai_match_results", { p_search: meta.search_id, p_limit: 5, p_offset: 0 })).data?.length ?? 0) === 0
      && ((await other.c.from("ai_match_results").select("creator_id").eq("search_id", meta.search_id)).data?.length ?? 0) === 0);
    check("…or its cached reasons", ((await other.c.from("ai_match_reasons").select("creator_id").eq("search_id", meta.search_id)).data?.length ?? 0) === 0);
    const emb = await brand.c.from("creator_embeddings").select("creator_id").limit(1);
    check("creator embeddings aren't readable by clients", !!emb.error || (emb.data?.length ?? 0) === 0);
    check("clients can't run the embedding queue", !!(await brand.c.rpc("creator_embedding_queue", { p_model: "x", p_limit: 1 })).error);
    check("recent searches list shows only my searches", ((await brand.c.from("ai_match_searches").select("brand_id")).data ?? []).every((s) => s.brand_id === brand.id));
    check("save works on my own results", !(await brand.c.rpc("set_ai_match_saved", { p_search: meta.search_id, p_creator: top, p_saved: true })).error
      && !!(await other.c.rpc("set_ai_match_saved", { p_search: meta.search_id, p_creator: top, p_saved: true })).error);

    console.log("\n▸ Fallback ranking (no embedding) + rate limit");
    const fb = (await brand.c.rpc("create_ai_match_search", { p_idea: "cinematic perfume film, keyword fallback", p_requirements: { keywords: ["cinematic", "perfume", "film"] }, p_mode: "tags", p_notice: "fallback test", p_model: null as unknown as string })).data as string;
    const n = (await brand.c.rpc("run_ai_match", { p_search: fb, p_query_embedding: "", p_weights: AI_MATCH_WEIGHTS, p_keep: 50 })).data as number;
    const fbRows = ((await brand.c.rpc("get_ai_match_results", { p_search: fb, p_limit: 3, p_offset: 0 })).data ?? []) as { breakdown: Record<string, unknown> }[];
    check("tag/keyword fallback still ranks creators", n >= 6 && fbRows.every((r) => !("semantic" in r.breakdown)) && fbRows.some((r) => typeof r.breakdown.keywords === "number"));
    let limited = false;
    for (let i = 0; i < 16 && !limited; i++) {
      const r = await brand.c.rpc("create_ai_match_search", { p_idea: "another idea for the rate limit check", p_requirements: {}, p_mode: "tags", p_notice: null as unknown as string, p_model: null as unknown as string });
      limited = !!r.error && /Too many AI searches/.test(r.error.message);
    }
    check("per-brand rate limit is enforced by the database", limited);
  } finally {
    for (const id of created) await admin.auth.admin.deleteUser(id);
    console.log("\n  (cleaned up the throwaway accounts and their searches)");
  }
  console.log(`\n${failures ? "✗" : "✓"} ${passes} passed, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
