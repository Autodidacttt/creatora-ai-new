import "server-only";
import { z } from "zod";
import { ThinkingLevel } from "@google/genai";
import type { Lookups } from "@/types/app";
import { creatorDataToAi } from "@/config/ai-match";
import { getGemini, withModelFallback } from "./gemini";

// AI Creator Finder: (a) turn a brand's idea into structured requirements (the brief builder's vocabulary: content
// type, style, specialization, tools, skills, platforms, audience) and (b) explain one match from real evidence.

export interface MatchRequirements {
  summary: string;
  content_type_id: number | null;
  style_id: number | null;
  category_id: number | null;
  tool_ids: number[];
  skill_ids: number[];
  platform_ids: number[];
  audience: string | null;
  keywords: string[];
}

export class FinderUnavailable extends Error {}

const names = (xs: { name: string }[]) => xs.map((x) => x.name);
const STOP = new Set("a an and the with for of to in on at by from that this into over under about our your their its is are be as or but not very more most some any one two three second seconds minute ad ads video videos content".split(" "));

/** Keyword words from the idea (fallback ranking + embedding-free mode). */
export function ideaKeywords(idea: string) {
  return [...new Set(idea.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 3 && w.length <= 40 && !STOP.has(w) && !/^\d+$/.test(w)))].slice(0, 12);
}

/** No-AI fallback: match lookup names that literally appear in the idea. */
export function keywordRequirements(idea: string, l: Lookups): MatchRequirements {
  const text = ` ${idea.toLowerCase()} `;
  const hits = (list: { id: number; name: string }[]) => list.filter((x) => text.includes(x.name.toLowerCase())).map((x) => x.id);
  return {
    summary: idea.slice(0, 200),
    content_type_id: hits(l.content_types)[0] ?? null,
    style_id: hits(l.styles)[0] ?? null,
    category_id: hits(l.categories)[0] ?? null,
    tool_ids: hits(l.ai_tools).slice(0, 5),
    skill_ids: hits(l.skills).slice(0, 5),
    platform_ids: hits(l.platforms).slice(0, 5),
    audience: null,
    keywords: ideaKeywords(idea),
  };
}

const parsedSchema = z.object({
  summary: z.string().max(400).default(""),
  content_type: z.string().nullable().optional(),
  style: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default([]),
  target_audience: z.string().max(300).nullable().optional(),
  keywords: z.array(z.string()).default([]),
});

/** Gemini → requirements, constrained to the live lookup vocabulary (same enums as the AI brief builder). */
export async function parseIdea(idea: string, l: Lookups): Promise<MatchRequirements> {
  const ai = getGemini();
  if (!ai) throw new FinderUnavailable("No GEMINI_API_KEY");
  const arr = (values: string[], max: number) => ({ type: "array", items: { type: "string", enum: values }, maxItems: max });
  const schema = {
    type: "object",
    properties: {
      summary: { type: "string", description: "One sentence: what kind of creator this idea needs" },
      content_type: { type: ["string", "null"], enum: [...names(l.content_types), null] },
      style: { type: ["string", "null"], enum: [...names(l.styles), null] },
      category: { type: ["string", "null"], enum: [...names(l.categories), null] },
      tools: arr(names(l.ai_tools), 5),
      skills: arr(names(l.skills), 5),
      platforms: arr(names(l.platforms), 4),
      target_audience: { type: ["string", "null"] },
      keywords: { type: "array", items: { type: "string" }, maxItems: 8, description: "Distinctive single words from the idea (subject, mood, product)" },
    },
    required: ["summary", "content_type", "style", "category", "tools", "skills", "platforms", "target_audience", "keywords"],
  };
  const res = await withModelFallback((model) => ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: `Brand idea:\n"""${idea}"""` }] }],
    config: {
      systemInstruction: "Extract the creator requirements implied by a brand's idea for an AI creator marketplace. Only use options from the enums; leave a field null/empty when the idea doesn't imply it. Never invent tools.",
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: AbortSignal.timeout(12_000),
    },
  }), 20_000);
  const out = parsedSchema.safeParse(JSON.parse(res.text ?? "{}"));
  if (!out.success) throw new Error("The AI response did not match the requirements schema");
  const o = out.data;
  const byName = (list: { id: number; name: string }[], name?: string | null) =>
    name ? list.find((x) => x.name.toLowerCase() === name.toLowerCase())?.id ?? null : null;
  const ids = (list: { id: number; name: string }[], xs: string[]) =>
    [...new Set(xs.map((n) => byName(list, n)).filter((x): x is number => x !== null))];
  return {
    summary: (o.summary || idea).slice(0, 300),
    content_type_id: byName(l.content_types, o.content_type),
    style_id: byName(l.styles, o.style),
    category_id: byName(l.categories, o.category),
    tool_ids: ids(l.ai_tools, o.tools),
    skill_ids: ids(l.skills, o.skills),
    platform_ids: ids(l.platforms, o.platforms),
    audience: o.target_audience?.slice(0, 200) ?? null,
    keywords: [...new Set([...o.keywords.flatMap((k) => ideaKeywords(k)), ...ideaKeywords(idea)])].slice(0, 12),
  };
}

const reasonSchema = z.object({
  reasons: z.array(z.string().min(3).max(220)).min(1).max(3),
  gaps: z.array(z.string().min(3).max(220)).max(3).default([]),
});

/** "Why this creator?" — 3 short reasons + gaps, strictly from the evidence the database returned. */
export async function explainMatch(evidence: unknown): Promise<{ reasons: string[]; gaps: string[]; model: string }> {
  // The evidence is the creator's profile + portfolio: only sent when that's switched on
  if (!creatorDataToAi()) throw new FinderUnavailable("AI_FINDER_SEND_CREATOR_DATA is off");
  const ai = getGemini();
  if (!ai) throw new FinderUnavailable("No GEMINI_API_KEY");
  let used = "";
  const res = await withModelFallback((model) => {
    used = model;
    return ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: `EVIDENCE (JSON):\n${JSON.stringify(evidence)}` }] }],
      config: {
        systemInstruction: [
          "You explain why one AI creator matches a brand's idea on a creator marketplace.",
          "Use ONLY facts present in the EVIDENCE JSON (their tools, skills, specializations, styles, portfolio posts, completed projects, availability).",
          "Never invent clients, numbers, awards or work that isn't in the evidence. Name the specific tool or post you rely on.",
          "Return exactly 3 short reasons (max 25 words each). If the evidence is thin, say so in a reason rather than guessing.",
          "List gaps: requirements of the idea the evidence does not show (empty if none).",
        ].join("\n"),
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            reasons: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
            gaps: { type: "array", items: { type: "string" }, maxItems: 3 },
          },
          required: ["reasons", "gaps"],
        },
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(15_000),
      },
    });
  }, 25_000);
  const out = reasonSchema.safeParse(JSON.parse(res.text ?? "{}"));
  if (!out.success) throw new Error("The AI response did not match the reasons schema");
  return { ...out.data, model: used };
}
