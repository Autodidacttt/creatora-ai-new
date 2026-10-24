// REPORT-ONLY: lists stored ID images that no verification row points at (older than 24 h, so in-flight uploads
// aren't reported). Deletes nothing — remove any listed file by hand in the Supabase dashboard after checking it.
// Usage: npm run report:id-orphans [-- --min-age-hours=24]
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const minAge = Number(process.argv.find((a) => a.startsWith("--min-age-hours="))?.split("=")[1] ?? 24);

async function main() {
  const { data, error } = await admin.rpc("identity_orphan_images", { p_min_age_hours: Number.isFinite(minAge) ? minAge : 24, p_limit: 1000 });
  if (error) throw new Error(`Couldn't read orphaned ID images: ${error.message}`);
  const rows = data ?? [];
  console.log(`${rows.length} orphaned ID image(s) older than ${minAge} h in identity-documents (report only, nothing deleted)`);
  for (const r of rows) {
    const hours = Math.round((Date.now() - new Date(r.created_at).getTime()) / 36e5);
    console.log(`  ${r.name}  ·  ${hours} h old  ·  ${r.size ?? "?"} bytes`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
