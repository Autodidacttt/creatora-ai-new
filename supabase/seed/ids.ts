import { createHash } from "node:crypto";

/** Deterministic UUID (v5-style) so every seed row has a stable id. Shared with the test scripts, which use it
 *  to recognise rows the seed created (as opposed to rows created through the app). */
export function seedId(key: string): string {
  const h = createHash("sha1").update(`creatora-seed:${key}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
