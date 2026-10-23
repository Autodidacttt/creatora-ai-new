// AI Creator Finder configuration — the one place to tune ranking. Weights are relative (they don't need to sum to
// 100): a component without a requirement in the idea (e.g. no tools named) drops out and the rest are rescaled.
// The resulting "Match score" (0-100) is relevance to the idea, not a rating of talent.

export const AI_MATCH_WEIGHTS = {
  /** Cosine similarity between the idea and the creator's profile + portfolio embedding */
  semantic: 40,
  /** Share of the required AI tools the creator uses */
  tools: 18,
  /** Share of the required skills */
  skills: 10,
  /** Creator / portfolio has the requested style, content type, specialization */
  style: 6,
  content_type: 6,
  specialization: 6,
  /** Experience level + completed projects on Creatora */
  experience: 8,
  /** Open > limited > booked */
  availability: 6,
  /** Fallback only (no embeddings): keyword match on profile + portfolio text */
  keywords: 30,
  /** Raw cosine similarity mapped to 0..1 between these bounds. Measured on gemini-embedding-2 (768 dims):
   *  unrelated ≈ 0.52, adjacent niche ≈ 0.71, strong match ≈ 0.88. */
  semantic_floor: 0.5,
  semantic_ceiling: 0.9,
} as const;

export const AI_MATCH = {
  /** Results kept per search (pages are read from the stored ranking) */
  keep: 200,
  pageSize: 12,
  ideaMin: 10,
  ideaMax: 400,
  /** Per-instance limit on top of the database limit (15 searches / 10 min per brand) */
  searchesPerMinute: 6,
  reasonsPerMinute: 20,
  /** Stale creator embeddings refreshed in the background after each search */
  refreshBatch: 20,
} as const;

/**
 * Creator profile + portfolio text is sent to Gemini (embeddings, "Why this creator?") only when the server env
 * AI_FINDER_SEND_CREATOR_DATA is "true". Off (the default): ranking uses tags + keywords, explanations are unavailable.
 */
export const creatorDataToAi = () => process.env.AI_FINDER_SEND_CREATOR_DATA === "true";

/** Query embeddings try these in order; creator embeddings use only the first, so all vectors share one model. */
export const EMBEDDING_MODELS = [process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2", "gemini-embedding-001"];
export const EMBEDDING_DIMENSIONS = 768;

export const AI_FINDER_EXAMPLES = [
  "A cinematic 30-second perfume ad with surreal, dreamlike visuals",
  "Playful 3D product animations of sneakers for TikTok",
  "Moody music video visuals with neon and glitch effects",
  "Clean AI fashion lookbook stills for an Instagram drop",
];
