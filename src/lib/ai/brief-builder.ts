import "server-only";
import { z } from "zod";
import type { Lookups } from "@/types/app";
import { CURRENCIES, EXCLUSIVITY, LICENSE_TYPES, USAGE_DURATIONS, USAGE_RIGHTS } from "@/config/constants";
import { ThinkingLevel } from "@google/genai";
import { getGemini, withModelFallback } from "./gemini";

const ASPECTS = ["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"] as const;

/** JSON schema handed to Gemini. Enums come from the live lookup tables so the model can only pick real options. */
function responseSchema(l: Lookups) {
  const names = (xs: { name: string }[]) => xs.map((x) => x.name);
  const arr = (values: string[], max: number) => ({ type: "array", items: { type: "string", enum: values }, maxItems: max });
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "Short, specific campaign title (max 100 chars)" },
      description: { type: "string", description: "2-4 sentence brief written for creators: goal, concept, tone" },
      deliverables: { type: "string", description: "Concrete list of assets, counts and durations" },
      target_audience: { type: "string" },
      content_type: { type: "string", enum: names(l.content_types) },
      style: { type: "string", enum: names(l.styles) },
      category: { type: "string", enum: names(l.categories) },
      aspect_ratios: arr([...ASPECTS], 4),
      platforms: arr(names(l.platforms), 5),
      tools: arr(names(l.ai_tools), 5),
      skills: arr(names(l.skills), 5),
      languages: arr(names(l.languages), 4),
      budget_min: { type: ["integer", "null"] },
      budget_max: { type: ["integer", "null"] },
      currency: { type: "string", enum: [...CURRENCIES] },
      deadline_days: { type: ["integer", "null"], description: "Days from today until delivery, null if unknown" },
      creators_needed: { type: "integer" },
      usage_rights: arr(USAGE_RIGHTS.map((u) => u.value), 6),
      territory: { type: "string" },
      usage_duration: { type: "string", enum: USAGE_DURATIONS.map((u) => u.value) },
      exclusivity: { type: "string", enum: EXCLUSIVITY.map((u) => u.value) },
      license_type: { type: "string", enum: LICENSE_TYPES.map((u) => u.value) },
      ai_disclosure_required: { type: "boolean" },
      assumptions: {
        type: "array", items: { type: "string" }, maxItems: 6,
        description: "Anything you inferred that the brand did not state explicitly",
      },
    },
    required: [
      "title", "description", "deliverables", "target_audience", "content_type", "style", "category", "aspect_ratios",
      "platforms", "tools", "skills", "languages", "currency", "creators_needed", "usage_rights", "territory",
      "usage_duration", "exclusivity", "license_type", "ai_disclosure_required", "assumptions",
    ],
  };
}

const aiOutput = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(10).max(4000),
  deliverables: z.string().max(2000).default(""),
  target_audience: z.string().max(500).default(""),
  content_type: z.string(),
  style: z.string(),
  category: z.string(),
  aspect_ratios: z.array(z.enum(ASPECTS)).min(1),
  platforms: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  budget_min: z.number().int().min(0).nullable().optional(),
  budget_max: z.number().int().min(0).nullable().optional(),
  currency: z.enum(CURRENCIES),
  deadline_days: z.number().int().min(1).max(365).nullable().optional(),
  creators_needed: z.number().int().min(1).max(100),
  usage_rights: z.array(z.enum(["organic_social", "paid_social", "broadcast", "ooh", "web", "internal"])).default([]),
  territory: z.string().min(1).max(80),
  usage_duration: z.enum(["3_months", "6_months", "12_months", "24_months", "perpetual"]),
  exclusivity: z.enum(["none", "category", "full"]),
  license_type: z.enum(["non_exclusive", "exclusive", "buyout", "limited"]),
  ai_disclosure_required: z.boolean(),
  assumptions: z.array(z.string()).default([]),
});

export interface BriefDraft {
  title: string;
  description: string;
  deliverables: string;
  target_audience: string;
  content_type_id: number | null;
  style_id: number | null;
  category_id: number | null;
  aspect_ratios: string[];
  platform_ids: number[];
  tool_ids: number[];
  skill_ids: number[];
  language_ids: number[];
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  deadline: string | null;
  creators_needed: number;
  usage_rights: string[];
  territory: string;
  usage_duration: string;
  exclusivity: string;
  license_type: string;
  ai_disclosure_required: boolean;
}

export class BriefBuilderUnavailable extends Error {}

const SYSTEM = `You turn a brand's rough idea into a structured creative brief for AI creators
(AI filmmakers, animators, generative artists) on a marketplace.
Rules:
- Only use options from the provided enums. Pick the closest match; never invent tools.
- Keep the brand's stated facts (counts, platforms, audience, budget, dates). Infer sensible defaults otherwise
  and list every inference in "assumptions".
- Formats: Instagram/TikTok/Shorts/Reels imply 9:16 (and 4:5 for Instagram feed); YouTube/CTV imply 16:9.
- Commercial use: paid ads need "paid_social"; default to a 12-month non-exclusive licence, worldwide unless a region is stated,
  and require AI disclosure.
- Budget: only fill if the brand gave one or an obvious range is implied; otherwise null.
- Write the description for creators: goal, concept, tone, must-haves. No marketing fluff.`;

/** Calls Gemini server-side and returns a validated draft with lookup ids. */
export async function buildBrief(prompt: string, lookups: Lookups): Promise<{ draft: BriefDraft; assumptions: string[] }> {
  const ai = getGemini();
  if (!ai) throw new BriefBuilderUnavailable("AI brief builder is not configured (no GEMINI_API_KEY).");

  const today = new Date().toISOString().slice(0, 10);
  const res = await withModelFallback((model) => ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: `Today is ${today}.\nBrand idea:\n"""${prompt}"""` }] }],
    config: {
      systemInstruction: SYSTEM,
      responseMimeType: "application/json",
      responseJsonSchema: responseSchema(lookups),
      temperature: 0.4,
      // Structured extraction needs little reasoning; low thinking keeps latency well inside Vercel limits
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: AbortSignal.timeout(15_000),
    },
  }));

  const text = res.text;
  if (!text) throw new Error("The AI returned an empty response.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The AI returned malformed JSON.");
  }
  const parsed = aiOutput.safeParse(json);
  if (!parsed.success) throw new Error("The AI response did not match the brief schema.");
  const o = parsed.data;

  const byName = (list: { id: number; name: string }[], name: string) =>
    list.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id ?? null;
  const ids = (list: { id: number; name: string }[], names: string[]) =>
    [...new Set(names.map((n) => byName(list, n)).filter((x): x is number => x !== null))];

  const budgetMin = o.budget_min ?? null;
  const budgetMax = o.budget_max ?? null;
  return {
    assumptions: o.assumptions.slice(0, 6),
    draft: {
      title: o.title.slice(0, 140),
      description: o.description,
      deliverables: o.deliverables,
      target_audience: o.target_audience,
      content_type_id: byName(lookups.content_types, o.content_type),
      style_id: byName(lookups.styles, o.style),
      category_id: byName(lookups.categories, o.category),
      aspect_ratios: [...new Set(o.aspect_ratios)],
      platform_ids: ids(lookups.platforms, o.platforms),
      tool_ids: ids(lookups.ai_tools, o.tools),
      skill_ids: ids(lookups.skills, o.skills),
      language_ids: ids(lookups.languages, o.languages),
      budget_min: budgetMin !== null && budgetMax !== null && budgetMin > budgetMax ? budgetMax : budgetMin,
      budget_max: budgetMin !== null && budgetMax !== null && budgetMin > budgetMax ? budgetMin : budgetMax,
      currency: o.currency,
      deadline: o.deadline_days ? new Date(Date.now() + o.deadline_days * 86_400_000).toISOString().slice(0, 10) : null,
      creators_needed: o.creators_needed,
      usage_rights: [...new Set(o.usage_rights)],
      territory: o.territory,
      usage_duration: o.usage_duration,
      exclusivity: o.exclusivity,
      license_type: o.license_type,
      ai_disclosure_required: o.ai_disclosure_required,
    },
  };
}
