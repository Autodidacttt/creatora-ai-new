import "server-only";

// Simple per-instance sliding-window limiter for expensive routes (AI, media processing).
const buckets = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  return recent.length > limit;
}
