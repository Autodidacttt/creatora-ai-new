// Model selection + fallback, shared by server routes and the seed script (no Next.js / server-only imports).

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

/** Tried in order after GEMINI_MODEL when a model is retired (404) or overloaded (429/5xx). */
// Measured on the brief schema (Oct 2026): 3.5-flash ≈3–4s, lite models ≈2–3s; 3.8-flash was timing out (>40s).
export const GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];

const TRANSIENT = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `call` against the configured model, then the fallbacks. Transient errors are retried once with
 * backoff; a retired model (404) moves straight to the next. Gives up when the time budget is spent.
 */
export async function withModelFallback<T>(call: (model: string) => Promise<T>, budgetMs = 45_000): Promise<T> {
  const models = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
  const started = Date.now();
  let lastError: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - started > budgetMs) throw lastError ?? new Error("AI request timed out");
      try {
        return await call(model);
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number }).status ?? 0;
        const name = (err as { name?: string }).name ?? "";
        const timedOut = name === "AbortError" || name === "TimeoutError" || /aborted|timed? ?out/i.test(String((err as Error).message));
        if (status === 404 || status === 400 || timedOut) break; // retired, unsupported or too slow right now: next model
        if (!TRANSIENT.has(status)) throw err;
        await sleep(700 * (attempt + 1));
      }
    }
  }
  throw lastError ?? new Error("No Gemini model available");
}
