// Creator embeddings for the AI Creator Finder. Shared by server routes and `npm run ai:embeddings`, so no
// "server-only" import here; callers pass a Gemini client and a service-role Supabase client.
import type { GoogleGenAI } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { creatorDataToAi, EMBEDDING_DIMENSIONS, EMBEDDING_MODELS } from "@/config/ai-match";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

/** Embeds texts with the first model that works. Returns the model used (stored with every vector). */
export async function embedTexts(ai: GoogleGenAI, texts: string[], taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT", models = EMBEDDING_MODELS) {
  let lastError: unknown;
  for (const model of [...new Set(models)]) {
    try {
      const res = await ai.models.embedContent({
        // One Content per text: a bare string array is merged into a single input
        model, contents: texts.map((text) => ({ role: "user", parts: [{ text }] })),
        config: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType, abortSignal: AbortSignal.timeout(20_000) },
      });
      const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) throw new Error("Unexpected embedding shape");
      return { model, vectors };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("No embedding model available");
}

/** pgvector text form */
export const toVectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;

/**
 * Builds/refreshes embeddings for creators that are missing one, were marked stale by a profile/portfolio change,
 * or were embedded with another model. Returns how many were (re)embedded. Does nothing unless creatorDataToAi().
 */
export async function refreshCreatorEmbeddings(admin: Admin, ai: GoogleGenAI, limit = 20, model = EMBEDDING_MODELS[0]): Promise<number> {
  if (!creatorDataToAi()) return 0;
  const started = Date.now();
  const { data: queue, error } = await admin.rpc("creator_embedding_queue", { p_model: model, p_limit: limit });
  if (error) throw error;
  const rows = (queue ?? []) as { creator_id: string; source: string | null; source_hash: string; queued_at: string }[];
  if (!rows.length) return 0;
  const texts = rows.map((r) => (r.source ?? "").slice(0, 8000) || "AI creator");
  try {
    // Only the requested model: vectors from a fallback model would be re-queued (and re-sent) on every run
    const { model: used, vectors } = await embedTexts(ai, texts, "RETRIEVAL_DOCUMENT", [model]);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const { error: e2 } = await admin.rpc("store_creator_embedding", {
        p_creator: r.creator_id, p_embedding: toVectorLiteral(vectors[i]), p_model: used, p_hash: r.source_hash, p_queued_at: r.queued_at,
      });
      if (e2) throw e2;
    }
    await admin.from("ai_job_logs").insert({ job: "creator_embeddings", status: "done", duration_ms: Date.now() - started, message: `${rows.length} creator(s) embedded with ${used}` });
    return rows.length;
  } catch (err) {
    await admin.from("ai_job_logs").insert({ job: "creator_embeddings", status: "failed", duration_ms: Date.now() - started, message: String((err as Error)?.message ?? err).slice(0, 500) });
    throw err;
  }
}
