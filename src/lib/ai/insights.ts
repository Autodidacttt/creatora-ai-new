import "server-only";
import { z } from "zod";
import { ThinkingLevel } from "@google/genai";
import type { AIInsights, EvidenceArea } from "@/services/dashboard";
import { GEMINI_MODEL, getGemini, withModelFallback } from "./gemini";

/** Evidence produced by dashboard_ai_evidence(): every number is a real database count. */
export interface Evidence {
  posts: number;
  workflow_posts: number;
  campaigns: number;
  hired: number;
  active_campaigns: number;
  areas: EvidenceArea[];
  demand: { id: string; label: string; campaigns: number }[];
  opportunities: { id: string; title: string; brand: string; score: number; reasons: string[] }[];
}

const out = z.object({
  strongest: z.array(z.object({ id: z.string(), label: z.string().max(40) })).max(3),
  opportunities: z.array(z.object({ id: z.string(), why: z.string().max(160) })).max(3),
  ideas: z.array(z.object({ idea: z.string().max(180), based_on: z.array(z.string()).max(3) })).max(3),
  trending: z.array(z.object({ id: z.string() })).max(4),
  brands_want: z.string().max(320),
});

const SYSTEM = `You write a short, evidence-based career summary for an AI creator on a marketplace.
You may ONLY reference items by the ids provided. Never invent numbers, percentages, scores or ratings,
and never output a "skill score". The UI shows the real counts next to whatever you pick.
- strongest: pick up to 3 areas where the creator has the most relevant work; give each a short display label
  (e.g. "AI Video", "Fashion Content", "Cinematic Style").
- opportunities: pick up to 3 of the given open briefs and say in one sentence why each fits, using only the given reasons.
- ideas: up to 3 concrete portfolio piece ideas that connect the creator's strengths to what brands ask for; cite ids in based_on.
- trending: up to 4 demand ids that matter most for this creator.
- brands_want: 1–2 sentences summarising what active briefs ask for, without numbers.`;

/** Deterministic, data-only ranking used when the AI is unavailable (labelled as such in the UI). */
function fallback(e: Evidence): Omit<AIInsights, "generated_at" | "model"> {
  const top = e.areas.slice(0, 3);
  const demand = e.demand.slice(0, 4);
  return {
    ai: false,
    strongest: top.map((a) => ({ id: a.id, label: a.label, evidence: a })),
    opportunities: e.opportunities.slice(0, 3).map((o) => ({ id: o.id, title: o.title, brand: o.brand, score: o.score, why: o.reasons[0] ?? "Matches your profile" })),
    ideas: [],
    trending: demand.map((d) => ({ id: d.id, label: d.label, campaigns: d.campaigns })),
    brands_want: demand.length ? `Active briefs most often ask for ${demand.slice(0, 3).map((d) => d.label).join(", ")}.` : "There are no active briefs right now.",
    totals: { posts: e.posts, workflow_posts: e.workflow_posts, campaigns: e.campaigns, hired: e.hired, active_campaigns: e.active_campaigns },
  };
}

export async function buildInsights(e: Evidence): Promise<{ insights: Omit<AIInsights, "generated_at" | "model">; model: string | null }> {
  const ai = getGemini();
  const areas = e.areas.slice(0, 15);
  const demand = e.demand.slice(0, 15);
  if (!ai || (!areas.length && !demand.length)) return { insights: fallback(e), model: null };

  const areaIds = areas.map((a) => a.id);
  const demandIds = demand.map((d) => d.id);
  const oppIds = e.opportunities.map((o) => o.id);
  const anyIds = [...new Set([...areaIds, ...demandIds])];
  const schema = {
    type: "object",
    properties: {
      strongest: { type: "array", maxItems: 3, items: { type: "object", properties: { id: { type: "string", enum: areaIds.length ? areaIds : ["none"] }, label: { type: "string" } }, required: ["id", "label"] } },
      opportunities: { type: "array", maxItems: 3, items: { type: "object", properties: { id: { type: "string", enum: oppIds.length ? oppIds : ["none"] }, why: { type: "string" } }, required: ["id", "why"] } },
      ideas: { type: "array", maxItems: 3, items: { type: "object", properties: { idea: { type: "string" }, based_on: { type: "array", maxItems: 3, items: { type: "string", enum: anyIds } } }, required: ["idea", "based_on"] } },
      trending: { type: "array", maxItems: 4, items: { type: "object", properties: { id: { type: "string", enum: demandIds.length ? demandIds : ["none"] } }, required: ["id"] } },
      brands_want: { type: "string" },
    },
    required: ["strongest", "opportunities", "ideas", "trending", "brands_want"],
  };

  try {
    let used = GEMINI_MODEL;
    const res = await withModelFallback((model) => {
      used = model;
      return ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: JSON.stringify({ areas, demand, opportunities: e.opportunities, totals: { posts: e.posts, campaigns: e.campaigns, hired: e.hired } }) }] }],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature: 0.5,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: AbortSignal.timeout(15_000),
        },
      });
    });
    const parsed = out.safeParse(JSON.parse(res.text ?? "{}"));
    if (!parsed.success) return { insights: fallback(e), model: null };
    const o = parsed.data;
    const areaById = new Map(e.areas.map((a) => [a.id, a]));
    const demandById = new Map(e.demand.map((d) => [d.id, d]));
    const oppById = new Map(e.opportunities.map((x) => [x.id, x]));
    const label = (id: string) => areaById.get(id)?.label ?? demandById.get(id)?.label ?? null;

    // Keep only ids that exist in the evidence; attach the real counts server-side.
    const strongest = o.strongest.flatMap((s) => { const ev = areaById.get(s.id); return ev ? [{ id: s.id, label: s.label || ev.label, evidence: ev }] : []; });
    return {
      model: used,
      insights: {
        ai: true,
        strongest: strongest.length ? strongest : fallback(e).strongest,
        opportunities: o.opportunities.flatMap((x) => { const op = oppById.get(x.id); return op ? [{ id: op.id, title: op.title, brand: op.brand, score: op.score, why: x.why }] : []; }),
        ideas: o.ideas.map((i) => ({ idea: i.idea, based_on: i.based_on.flatMap((id) => { const l = label(id); return l ? [{ id, label: l }] : []; }) })),
        trending: o.trending.flatMap((t) => { const d = demandById.get(t.id); return d ? [{ id: d.id, label: d.label, campaigns: d.campaigns }] : []; }),
        brands_want: o.brands_want,
        totals: { posts: e.posts, workflow_posts: e.workflow_posts, campaigns: e.campaigns, hired: e.hired, active_campaigns: e.active_campaigns },
      },
    };
  } catch (err) {
    console.warn("[dashboard/insights] AI unavailable, using data-only ranking:", err instanceof Error ? err.message : err);
    return { insights: fallback(e), model: null };
  }
}
