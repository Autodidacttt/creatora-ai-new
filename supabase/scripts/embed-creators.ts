// Builds / refreshes creator embeddings for the AI Creator Finder (backfill for existing + seed creators, or after a
// model change). Safe to re-run: only creators that are missing, stale or on another model are embedded.
// Sends each creator's profile + portfolio text to the Gemini embeddings API, so it only runs with
// AI_FINDER_SEND_CREATOR_DATA=true (in .env.local or the environment).
// Usage: npm run ai:embeddings
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { requireEnv } from "./env";
import { refreshCreatorEmbeddings } from "../../src/lib/ai/embeddings";
import { creatorDataToAi } from "../../src/config/ai-match";

async function main() {
  if (!creatorDataToAi()) {
    console.error("AI_FINDER_SEND_CREATOR_DATA isn't \"true\": no creator data was sent. Set it once sharing creator profiles with Gemini is approved.");
    process.exit(1);
  }
  const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
  const ai = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  let total = 0;
  for (let round = 0; round < 100; round++) {
    const n = await refreshCreatorEmbeddings(admin, ai, 25);
    total += n;
    if (n === 0) break;
    console.log(`  embedded ${n} creator(s)…`);
  }
  const { count } = await admin.from("creator_embeddings").select("creator_id", { count: "exact", head: true }).eq("stale", false).not("embedding", "is", null);
  console.log(`Done: ${total} embedded this run · ${count ?? 0} creators indexed.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
