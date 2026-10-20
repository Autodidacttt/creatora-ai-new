import "server-only";
import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import type { Lookups } from "@/types/app";
import { CURRENCIES, EXCLUSIVITY, LICENSE_TYPES, USAGE_DURATIONS, USAGE_RIGHTS } from "@/config/constants";
import { STUDIO_ASPECTS, studioBriefSchema, type BriefSection, type StudioBrief } from "@/lib/validation/workspace";
import { getGemini, withModelFallback } from "./gemini";

export class StudioAIUnavailable extends Error {}

// ---------------------------------------------------------------------------
// Link summary
// ---------------------------------------------------------------------------
const linkSummarySchema = z.object({
  summary: z.string().max(900),
  brand: z.string().max(120).nullable(),
  product: z.string().max(160).nullable(),
  key_points: z.array(z.string().max(200)).max(5),
});
export type LinkSummary = z.infer<typeof linkSummarySchema>;

export async function summarizePage(page: { url: string; title: string | null; description: string | null; site: string | null; text: string }): Promise<{ summary: LinkSummary; model: string | null }> {
  const fallback: LinkSummary = {
    summary: [page.title, page.description].filter(Boolean).join(" — ").slice(0, 900) || "No readable summary on this page.",
    brand: page.site, product: null, key_points: [],
  };
  const ai = getGemini();
  if (!ai || page.text.length < 40) return { summary: fallback, model: null };
  let used = "";
  try {
    const res = await withModelFallback(async (model) => {
      used = model;
      return ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: `URL: ${page.url}\nTitle: ${page.title ?? ""}\nDescription: ${page.description ?? ""}\nPage text:\n"""${page.text}"""` }] }],
        config: {
          systemInstruction: "Summarise this web page for a brand that wants to brief AI creators about it. Stick to what the page says; don't invent facts. 2-3 sentences, then up to 5 short key points (product, audience, claims, visual cues).",
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              summary: { type: "string" }, brand: { type: ["string", "null"] }, product: { type: ["string", "null"] },
              key_points: { type: "array", items: { type: "string" }, maxItems: 5 },
            },
            required: ["summary", "brand", "product", "key_points"],
          },
          temperature: 0.2,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: AbortSignal.timeout(15_000),
        },
      });
    }, 30_000);
    const parsed = linkSummarySchema.safeParse(JSON.parse(res.text ?? "null"));
    return parsed.success ? { summary: parsed.data, model: used } : { summary: fallback, model: null };
  } catch {
    return { summary: fallback, model: null };
  }
}

// ---------------------------------------------------------------------------
// Structured brief
// ---------------------------------------------------------------------------
function responseSchema(l: Lookups) {
  const names = (xs: { name: string }[]) => xs.map((x) => x.name);
  const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
  const list = (max: number, description?: string) => ({ type: "array", items: { type: "string" }, maxItems: max, ...(description ? { description } : {}) });
  return {
    type: "object",
    properties: {
      title: str("Specific campaign title, max 100 characters"),
      objective: str("What the campaign must achieve, one or two sentences"),
      summary: str("The concept written for creators: story, mood, must-haves. 3-5 sentences."),
      audience: str(),
      tone: str("Tone of voice in a few words"),
      deliverables: list(8, "Concrete assets with counts, durations and formats"),
      content_type: { type: ["string", "null"], enum: [...names(l.content_types), null] },
      style: { type: ["string", "null"], enum: [...names(l.styles), null] },
      category: { type: ["string", "null"], enum: [...names(l.categories), null] },
      platforms: { type: "array", items: { type: "string", enum: names(l.platforms) }, maxItems: 5 },
      aspect_ratios: { type: "array", items: { type: "string", enum: [...STUDIO_ASPECTS] }, maxItems: 4 },
      timeline: str("Milestones in one line, e.g. 'Concepts in 3 days, finals in 10'"),
      deadline_days: { type: ["integer", "null"] },
      budget: {
        type: "object",
        properties: {
          min: { type: ["integer", "null"] }, max: { type: ["integer", "null"] },
          currency: { type: "string", enum: [...CURRENCIES] },
          guidance: str("Why this range: scope, number of assets, usage. Say clearly when it's only a rough market guide."),
        },
        required: ["min", "max", "currency", "guidance"],
      },
      requirements: list(8, "Must-haves and constraints (brand safety, assets to use, approvals)"),
      suggested_tools: list(6, "AI tools/models that fit; prefer names from the known tool list"),
      production: {
        type: "object",
        properties: {
          camera: str("Shot types, lenses, movement"), lighting: str("Lighting direction and mood"),
          style: str("Look, colour grade, references"), format: str("Durations, frame rates, safe zones, versions"),
        },
        required: ["camera", "lighting", "style", "format"],
      },
      ip: {
        type: "object",
        properties: {
          usage_rights: { type: "array", items: { type: "string", enum: USAGE_RIGHTS.map((u) => u.value) }, maxItems: 6 },
          territory: str(),
          usage_duration: { type: "string", enum: USAGE_DURATIONS.map((u) => u.value) },
          exclusivity: { type: "string", enum: EXCLUSIVITY.map((u) => u.value) },
          license_type: { type: "string", enum: LICENSE_TYPES.map((u) => u.value) },
          ai_disclosure_required: { type: "boolean" },
          notes: str("Ownership, credit, model releases, anything else about rights"),
        },
        required: ["usage_rights", "territory", "usage_duration", "exclusivity", "license_type", "ai_disclosure_required", "notes"],
      },
      creators_needed: { type: "integer" },
    },
    required: ["title", "objective", "summary", "audience", "tone", "deliverables", "content_type", "style", "category", "platforms",
      "aspect_ratios", "timeline", "deadline_days", "budget", "requirements", "suggested_tools", "production", "ip", "creators_needed"],
  };
}

const SYSTEM = `You are a senior creative producer. Turn a brand's idea (and optional web page summary) into a precise brief for AI creators
(AI filmmakers, motion designers, generative artists).
Rules:
- Use only enum values where enums are given. Keep the brand's stated facts; infer sensible defaults otherwise.
- Formats: TikTok/Reels/Shorts → 9:16; Instagram feed → 4:5 or 1:1; YouTube/CTV → 16:9.
- Commercial use: paid ads need "paid_social". Default to a 12-month non-exclusive licence, worldwide unless a region is stated,
  and require AI disclosure.
- Budget: if the brand gave one, keep it. Otherwise give a cautious range and say in "guidance" that it's a rough guide, not a quote.
- Camera/lighting/style suggestions must be practical for AI video/image tools (prompts, references, consistency tips).
- No marketing fluff. Short, concrete sentences.`;

export async function generateStudioBrief(
  input: { idea: string; linkSummary?: string | null; section?: BriefSection | null; current?: unknown },
  lookups: Lookups,
): Promise<{ brief: StudioBrief; model: string }> {
  const ai = getGemini();
  if (!ai) throw new StudioAIUnavailable("AI is not configured (no GEMINI_API_KEY).");
  const today = new Date().toISOString().slice(0, 10);
  const toolHint = lookups.ai_tools.map((t) => t.name).join(", ");
  const parts = [
    `Today is ${today}.`,
    input.idea ? `Brand idea:\n"""${input.idea}"""` : "",
    input.linkSummary ? `Summary of the brand's reference page:\n"""${input.linkSummary}"""` : "",
    `Known AI tools: ${toolHint}`,
    input.section && input.current
      ? `Current brief (JSON):\n${JSON.stringify(input.current).slice(0, 8000)}\n\nRewrite ONLY the "${input.section}" part with a fresh, better take. Return the whole brief; keep every other field exactly as it is.`
      : "",
  ].filter(Boolean).join("\n\n");

  let used = "";
  const res = await withModelFallback(async (model) => {
    used = model;
    return ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: parts }] }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema(lookups),
        temperature: input.section ? 0.8 : 0.5,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(25_000),
      },
    });
  }, 50_000);

  const text = res.text;
  if (!text) throw new Error("The AI returned an empty response.");
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The AI returned malformed JSON.");
  }
  // Light normalisation before strict validation
  const b = (json.budget ?? {}) as Record<string, unknown>;
  if (typeof b.min === "number" && typeof b.max === "number" && b.min > b.max) [b.min, b.max] = [b.max, b.min];
  json.title = String(json.title ?? "").slice(0, 140);
  json.creators_needed = Math.min(50, Math.max(1, Number(json.creators_needed) || 1));
  if (typeof json.deadline_days === "number") json.deadline_days = Math.min(365, Math.max(1, Math.round(json.deadline_days)));
  if (!Array.isArray(json.aspect_ratios) || !json.aspect_ratios.length) json.aspect_ratios = ["9:16"];

  const parsed = studioBriefSchema.safeParse(json);
  if (!parsed.success) throw new Error(`The AI brief didn't validate (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message})`);
  return { brief: parsed.data, model: used };
}
