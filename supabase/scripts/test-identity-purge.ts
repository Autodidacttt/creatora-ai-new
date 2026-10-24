// Regression checks for the ID-image retention purge (0028): retention boundary, pending rows, missing files,
// concurrent runs, storage / database failures and retries, single audit entries, the cron secret and the
// report-only orphan scan. ISOLATED TEST PROJECT + LOCAL APP ONLY: it refuses to run unless CREATORA_TARGET matches
// SUPABASE_URL and APP_URL is localhost (so it can never trigger the production purge). Needs CRON_SECRET set for
// both the app and this script. Throwaway users, rows and files are deleted afterwards.
// Usage: npm run test:purge
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";
import { BUCKET_IDENTITY, PurgeQueryError, purgeExpiredIdImages, type PurgeResult } from "../../src/lib/verification/purge";

const URL_ = requireEnv("SUPABASE_URL");
const SECRET = requireEnv("SUPABASE_SECRET_KEY");
const CRON_SECRET = requireEnv("CRON_SECRET");
const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const target = process.env.CREATORA_TARGET;
if (!target || new URL(URL_).hostname.split(".")[0] !== target || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(APP)) {
  console.error("test:purge runs only against the isolated test project and a local app (CREATORA_TARGET + localhost APP_URL).");
  process.exit(2);
}
if (process.env.ID_RETENTION_DAYS) { console.error("Unset ID_RETENTION_DAYS: these checks assume the default 30 days."); process.exit(2); }
const admin = createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });

let passes = 0, failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passes++; else failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
const DAY = 86_400_000, HOUR = 3_600_000;
const hex64 = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const bucket = () => admin.storage.from(BUCKET_IDENTITY);
// exists() → true, or false (with a 400 error) once the object is gone
const stored = async (path: string) => (await bucket().exists(path)).data === true;
const row = async (id: string) => (await admin.from("identity_verifications").select("id_image_path, image_deleted_at").eq("id", id).single()).data!;
const deletedAudits = async (ids: string[]) =>
  (await admin.from("audit_logs").select("target_id").eq("action", "identity_image_deleted").in("target_id", ids)).data ?? [];
const failedAudits = async (ids: string[]) =>
  (await admin.from("audit_logs").select("target_id, meta").eq("action", "identity_image_purge_failed").in("target_id", ids)).data ?? [];
const fmt = (r: PurgeResult) => JSON.stringify(r);
const run = (client: SupabaseClient = admin) => purgeExpiredIdImages(client, { trigger: "app", force: true });

/** Wraps the real admin client and injects one failure. */
function faulty(o: { rpc?: string; remove?: "error" | "silent" }) {
  return {
    rpc: (fn: string, args: object) => (fn === o.rpc ? Promise.resolve({ data: null, error: { code: "XX000", message: "injected" } }) : admin.rpc(fn, args)),
    storage: {
      from: (b: string) => (o.remove === "error"
        ? { remove: async () => ({ data: null, error: { name: "StorageApiError", message: "injected" } }) }
        : o.remove === "silent" ? { remove: async () => ({ data: [], error: null }) } : admin.storage.from(b)),
    },
    from: (t: string) => admin.from(t),
  } as unknown as SupabaseClient;
}

async function main() {
  if (!(await fetch(APP, { redirect: "manual" }).catch(() => null))) throw new Error(`App isn't reachable at ${APP}`);
  const before = (await admin.rpc("identity_images_due", { p_days: 30, p_limit: 200 })).data ?? [];
  if (before.length) throw new Error(`${before.length} image(s) are already due in this database — the counts below assume none.`);
  const started = new Date().toISOString();
  const stamp = Date.now();
  const users: string[] = [];
  const rowIds: string[] = [];
  const paths: string[] = [];
  const mkUser = async (tag: string) => {
    const r = await admin.auth.admin.createUser({ email: `purge-${tag}-${stamp}@example.com`, password: `Pg-${stamp}-Aa1!`, email_confirm: true, user_metadata: { role: "creator", display_name: `Purge ${tag}` } });
    if (r.error || !r.data.user) throw new Error(r.error?.message);
    users.push(r.data.user.id);
    return r.data.user.id;
  };
  /** A verification row (decided `reviewedAgo` ms ago, or pending) with an uploaded image unless `upload: false`. */
  const mkRow = async (user: string, status: "verified" | "rejected" | "pending", reviewedAgo: number | null, upload = true) => {
    const path = `${user}/${crypto.randomUUID()}.jpg`;
    if (upload) {
      const up = await bucket().upload(path, jpeg, { contentType: "image/jpeg" });
      if (up.error) throw new Error(`upload: ${up.error.message}`);
    }
    paths.push(path);
    const { data, error } = await admin.from("identity_verifications").insert({
      user_id: user, kind: "creator", status, full_name: "Purge Test", id_type: "national_id", id_number_hash: hex64(), id_last4: "0001",
      dob: "1990-01-01", id_image_path: path, phone_hash: hex64(), consent_at: new Date().toISOString(),
      reviewed_at: reviewedAgo === null ? null : new Date(Date.now() - reviewedAgo).toISOString(),
      created_at: new Date(Date.now() - (reviewedAgo ?? 60 * DAY) - HOUR).toISOString(),
    }).select("id").single();
    if (error || !data) throw new Error(`insert: ${error?.message}`);
    rowIds.push(data.id);
    return { id: data.id as string, path };
  };

  try {
    const u = await mkUser("decided");
    const pendingUser = await mkUser("pending");

    console.log("\n▸ Retention boundary, pending rows, already-missing files");
    const due = await mkRow(u, "verified", 30 * DAY + HOUR);
    const edge = await mkRow(u, "rejected", 30 * DAY - HOUR);
    const pending = await mkRow(pendingUser, "pending", null);
    const missing = await mkRow(u, "verified", 45 * DAY, false);
    const r1 = await run();
    check("counts are exact: 2 due, 1 deleted, 1 already missing, 2 marked, 0 failed",
      r1.due === 2 && r1.deleted === 1 && r1.already_missing === 1 && r1.marked === 2 && r1.failed === 0 && r1.already_marked === 0, fmt(r1));
    check("past 30 days: image removed from storage", !(await stored(due.path)));
    check("…and the row marked (path cleared, deleted_at set)", (await row(due.id)).id_image_path === null && !!(await row(due.id)).image_deleted_at);
    check("1 hour inside 30 days: untouched (image + row)", (await stored(edge.path)) && (await row(edge.id)).id_image_path === edge.path && !(await row(edge.id)).image_deleted_at);
    check("pending (no decision yet): untouched", (await stored(pending.path)) && (await row(pending.id)).id_image_path === pending.path);
    check("already-missing image: row marked anyway", !!(await row(missing.id)).image_deleted_at);
    check("one 'identity_image_deleted' audit entry per marked row", (await deletedAudits([due.id, missing.id])).length === 2);
    const summary = (await admin.from("audit_logs").select("meta").eq("action", "identity_image_purge_run").gte("created_at", started)).data ?? [];
    check("run summary audit entry with the counts", summary.some((s) => (s.meta as PurgeResult).marked === 2 && (s.meta as PurgeResult).due === 2));

    console.log("\n▸ Repeats are no-ops (no duplicate audit entries)");
    const r2 = await run();
    check("second run: nothing due", r2.due === 0 && r2.marked === 0 && r2.failed === 0, fmt(r2));
    check("marking an already-purged row again → 'already_marked'", (await admin.rpc("identity_image_purged", { p_id: due.id })).data === "already_marked");
    check("…still exactly one audit entry per row", (await deletedAudits([due.id, missing.id])).length === 2);
    const runsAfter = (await admin.from("audit_logs").select("id").eq("action", "identity_image_purge_run").gte("created_at", started)).data ?? [];
    check("no summary entry for a run with nothing to do", runsAfter.length === summary.length);

    console.log("\n▸ Storage failure → nothing marked, logged, retried");
    const f1 = await mkRow(u, "verified", 31 * DAY), f2 = await mkRow(u, "rejected", 40 * DAY);
    const r3 = await run(faulty({ remove: "error" }));
    check("storage error: 2 failed, 0 deleted, 0 marked", r3.due === 2 && r3.failed === 2 && r3.deleted === 0 && r3.marked === 0, fmt(r3));
    check("images still stored, rows still due", (await stored(f1.path)) && (await stored(f2.path)) && !(await row(f1.id)).image_deleted_at && !(await row(f2.id)).image_deleted_at);
    const fa = await failedAudits([f1.id, f2.id]);
    check("failure audit-logged per row (step 'storage', no path / personal data)", fa.length === 2 && fa.every((a) => (a.meta as { step: string }).step === "storage" && !JSON.stringify(a.meta).includes("/")));
    const r4 = await run();
    check("retry: both deleted and marked", r4.due === 2 && r4.deleted === 2 && r4.marked === 2 && r4.failed === 0, fmt(r4));
    check("…images gone", !(await stored(f1.path)) && !(await stored(f2.path)));

    console.log("\n▸ Storage says OK but the image is still there → not marked");
    const s1 = await mkRow(u, "verified", 35 * DAY);
    const r5 = await run(faulty({ remove: "silent" }));
    check("database refuses to mark while the object exists ('object_present' → failed)", r5.failed === 1 && r5.marked === 0 && !(await row(s1.id)).image_deleted_at && (await stored(s1.path)), fmt(r5));
    const r6 = await run();
    check("retry: deleted and marked", r6.deleted === 1 && r6.marked === 1 && !(await stored(s1.path)), fmt(r6));

    console.log("\n▸ Database failure while marking → retried, counted as already missing");
    const m1 = await mkRow(u, "verified", 33 * DAY);
    const r7 = await run(faulty({ rpc: "identity_image_purged" }));
    check("mark error: image deleted, row not marked, 1 failed", r7.deleted === 1 && r7.marked === 0 && r7.failed === 1 && !(await stored(m1.path)) && !(await row(m1.id)).image_deleted_at, fmt(r7));
    check("failure audit-logged with step 'mark'", (await failedAudits([m1.id])).some((a) => (a.meta as { step: string }).step === "mark"));
    const r8 = await run();
    check("retry: marked, counted as already missing (not deleted twice)", r8.due === 1 && r8.deleted === 0 && r8.already_missing === 1 && r8.marked === 1, fmt(r8));
    check("…one audit entry", (await deletedAudits([m1.id])).length === 1);

    console.log("\n▸ Due-images query fails → error, nothing touched");
    const q1 = await mkRow(u, "verified", 32 * DAY);
    let threw = false;
    try { await run(faulty({ rpc: "identity_images_due" })); } catch (e) { threw = e instanceof PurgeQueryError; }
    check("throws PurgeQueryError", threw);
    check("image and row untouched", (await stored(q1.path)) && !(await row(q1.id)).image_deleted_at);
    await run();

    console.log("\n▸ Concurrent runs");
    const cs = [await mkRow(u, "verified", 31 * DAY), await mkRow(u, "verified", 32 * DAY), await mkRow(u, "rejected", 33 * DAY), await mkRow(u, "verified", 34 * DAY)];
    const [ca, cb] = await Promise.all([run(), run()]);
    check("together: each image deleted once, each row marked once, nothing failed",
      ca.deleted + cb.deleted === 4 && ca.marked + cb.marked === 4 && ca.failed + cb.failed === 0, `${fmt(ca)} / ${fmt(cb)}`);
    check("all images gone and rows marked", (await Promise.all(cs.map(async (c) => !(await stored(c.path)) && !!(await row(c.id)).image_deleted_at))).every(Boolean));
    check("exactly one audit entry per row", (await deletedAudits(cs.map((c) => c.id))).length === 4);

    console.log("\n▸ Cron route + secret (local app)");
    const cron = (auth?: string) => fetch(`${APP}/api/cron/purge-identity`, { headers: auth ? { authorization: auth } : {} });
    check("no Authorization header → 401", (await cron()).status === 401);
    check("wrong secret → 401", (await cron("Bearer not-the-secret")).status === 401);
    check("secret without 'Bearer ' → 401", (await cron(CRON_SECRET)).status === 401);
    check("lower-case 'bearer' → 401", (await cron(`bearer ${CRON_SECRET}`)).status === 401);
    check("secret plus extra characters → 401", (await cron(`Bearer ${CRON_SECRET}x`)).status === 401);
    const h1 = await mkRow(u, "verified", 31 * DAY);
    const ok = await cron(`Bearer ${CRON_SECRET}`);
    const body = (await ok.json()) as PurgeResult;
    check("correct secret → 200 with exact counts", ok.status === 200 && body.due === 1 && body.deleted === 1 && body.marked === 1 && body.failed === 0, `${ok.status} ${JSON.stringify(body)}`);
    check("cron run reports the orphan count", typeof body.orphans === "number");
    check("…and purged the row", !(await stored(h1.path)) && !!(await row(h1.id)).image_deleted_at);

    console.log("\n▸ Orphan scan is report-only");
    const orphan = `${u}/${crypto.randomUUID()}.jpg`;
    await bucket().upload(orphan, jpeg, { contentType: "image/jpeg" });
    paths.push(orphan);
    type Orphan = { name: string };
    const scan0 = ((await admin.rpc("identity_orphan_images", { p_min_age_hours: 0, p_limit: 1000 })).data ?? []) as Orphan[];
    check("an image with no verification row is reported", scan0.some((o) => o.name === orphan));
    check("images that belong to a row are not", !scan0.some((o) => o.name === edge.path || o.name === pending.path));
    const scan24 = ((await admin.rpc("identity_orphan_images", { p_min_age_hours: 24 })).data ?? []) as Orphan[];
    check("fresh uploads are skipped at the default 24 h age", !scan24.some((o) => o.name === orphan));
    check("…and nothing is deleted by the scan", await stored(orphan));
    const r9 = await run();
    check("the purge leaves orphans alone too", r9.due === 0 && (await stored(orphan)), fmt(r9));
    check("clients can't call the purge / orphan functions", !!(await createClient(URL_, requireEnv("SUPABASE_PUBLISHABLE_KEY")).rpc("identity_orphan_images", {})).error);
  } finally {
    // Clean up (test project only): files, users (rows cascade) and the audit entries this run created
    if (paths.length) await bucket().remove(paths);
    for (const id of users) await admin.auth.admin.deleteUser(id);
    if (rowIds.length) await admin.from("audit_logs").delete().in("target_id", rowIds);
    await admin.from("audit_logs").delete().eq("action", "identity_image_purge_run").gte("created_at", started);
    console.log("\n  (cleaned up the throwaway users, rows, images and audit entries)");
  }
  console.log(`\n${failures ? "✗" : "✓"} ${passes} passed, ${failures} failed\n`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
