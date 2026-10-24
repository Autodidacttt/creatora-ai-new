import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mockIdentityApiKey, verificationSettings } from "./settings";

export const BUCKET_IDENTITY = "identity-documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** Deletes ID images ID_RETENTION_DAYS after the decision (and records it). Safe to call often. */
let lastPurge = 0;
export async function purgeExpiredIdImages(admin: Admin, force = false): Promise<number> {
  if (!force && Date.now() - lastPurge < 10 * 60_000) return 0;
  lastPurge = Date.now();
  const { data } = await admin.rpc("identity_images_due", { p_days: verificationSettings().retentionDays, p_limit: 100 });
  const due = (data ?? []) as { id: string; id_image_path: string }[];
  for (const d of due) {
    const { error } = await admin.storage.from(BUCKET_IDENTITY).remove([d.id_image_path]);
    if (!error) await admin.rpc("identity_image_purged", { p_id: d.id });
  }
  return due.length;
}

/**
 * Calls the app's own mock government-ID service the way an external API would be called (HTTP, API key, JSON).
 * The result is advisory and labelled as simulated; an admin makes the decision.
 */
export async function runMockIdentityCheck(origin: string, input: { name: string; id_number: string; dob: string }) {
  const started = Date.now();
  try {
    const res = await fetch(`${origin}/api/mock-identity/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": mockIdentityApiKey() },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { result?: string };
    const result = res.ok && (json.result === "Identity Verified" || json.result === "Identity Not Verified") ? json.result : "Check unavailable";
    return { result, simulated: true, label: "Simulated check, not a government verification", checked_at: new Date().toISOString(), latency_ms: Date.now() - started };
  } catch {
    return { result: "Check unavailable", simulated: true, label: "Simulated check, not a government verification", checked_at: new Date().toISOString(), latency_ms: Date.now() - started };
  }
}
