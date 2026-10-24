import "server-only";
import { mockIdentityApiKey } from "./settings";

export { BUCKET_IDENTITY, PurgeQueryError, purgeExpiredIdImages, type PurgeResult } from "./purge";

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
