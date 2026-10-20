// Submission review: deterministic checks (colours, format, AI-use declaration) + AI-assisted checks
// (logo, visual style, typography) + creative estimates (hook, pacing, retention).
// Node only. Used by the API (background job) and by the seed script.
import type { GoogleGenAI } from "@google/genai";
import { ThinkingLevel } from "@google/genai";
import sharp from "sharp";
import { z } from "zod";
import { compareToBrand, extractPalette, type ColourMatch } from "@/lib/media/palette";
import { withModelFallback } from "@/lib/ai/models";

export type CheckStatus = "pass" | "warn" | "fail" | "na";
export type CheckMethod = "deterministic" | "ai_assisted" | "declaration";

export interface ReviewCheck {
  status: CheckStatus;
  explanation: string;
  evidence: string[];
  method: CheckMethod;
}
export interface ColourCheck extends ReviewCheck {
  matches: ColourMatch[];
  coverage: number;
  palette: { hex: string; share: number }[];
}
export interface DisclosureCheck extends ReviewCheck {
  required: boolean;
  declared: boolean;
  tools_declared: string[];
  tools_in_brief: string[];
  tools_overlap: string[];
}
export interface ReviewChecks {
  logo: ReviewCheck;
  colors: ColourCheck;
  visual_style: ReviewCheck;
  typography: ReviewCheck;
  ai_disclosure: DisclosureCheck;
  format: ReviewCheck;
}
export interface Estimate {
  rating: "strong" | "ok" | "weak";
  explanation: string;
  based_on: string[];
}
export interface ReviewInsights {
  is_estimate: true;
  hook: Estimate | null;
  pacing: Estimate | null;
  retention: { level: "high" | "medium" | "low"; explanation: string; based_on: string[] } | null;
  unavailable_reason?: string;
}
export interface ReviewResult {
  checks: ReviewChecks;
  insights: ReviewInsights;
  score: number | null;
  model: string | null;
  aiError: string | null;
}

export interface ReviewAsset {
  media_type: "image" | "video" | "link";
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  link_url: string | null;
  frames: Buffer[]; // small un-watermarked JPEGs (one for an image, several for a video)
}

export interface ReviewInput {
  campaign: {
    title: string;
    description: string;
    deliverables: string | null;
    aspect_ratios: string[];
    ai_disclosure_required: boolean;
    tools: string[];
    suggested_tools: string[];
    style: string | null;
    content_type: string | null;
  };
  guideline: {
    primary_colors: string[];
    secondary_colors: string[];
    fonts: string[];
    tone_of_voice: string | null;
    visual_style: string | null;
    dos: string[];
    donts: string[];
    restricted_content: string | null;
  } | null;
  submission: {
    version: number;
    notes: string | null;
    tools_used: string[];
    workflow_notes: string | null;
    ai_generated_declared: boolean;
  };
  assets: ReviewAsset[];
  logo: Buffer | null;
}

const POINTS: Record<Exclude<CheckStatus, "na">, number> = { pass: 100, warn: 50, fail: 0 };

/** Brand Match score = the checklist, nothing else: pass 100 / warn 50 / fail 0, averaged over applicable checks. */
export function brandMatchScore(checks: Pick<ReviewChecks, "logo" | "colors" | "visual_style" | "typography">): number | null {
  const applicable = [checks.logo, checks.colors, checks.visual_style, checks.typography].filter((c) => c.status !== "na");
  if (!applicable.length) return null;
  return Math.round(applicable.reduce((s, c) => s + POINTS[c.status as Exclude<CheckStatus, "na">], 0) / applicable.length);
}

// ---------------------------------------------------------------------------
// Deterministic checks
// ---------------------------------------------------------------------------
async function stackedPalette(frames: Buffer[]) {
  if (!frames.length) return [];
  const tiles = await Promise.all(frames.slice(0, 12).map((f) => sharp(f).resize(128, 128, { fit: "cover" }).removeAlpha().png().toBuffer()));
  const sheet = await sharp({ create: { width: 128, height: 128 * tiles.length, channels: 3, background: "#000" } })
    .composite(tiles.map((input, i) => ({ input, top: i * 128, left: 0 })))
    .raw().toBuffer();
  return extractPalette(sheet, 3, 8, 20_000);
}

export async function colourCheck(input: ReviewInput): Promise<ColourCheck> {
  const frames = input.assets.flatMap((a) => a.frames);
  const palette = await stackedPalette(frames);
  const brand = [...(input.guideline?.primary_colors ?? []), ...(input.guideline?.secondary_colors ?? [])];
  const primary = input.guideline?.primary_colors ?? [];
  if (!brand.length) {
    return { status: "na", method: "deterministic", explanation: "No brand colours are set in the guidelines for this campaign.", evidence: [], matches: [], coverage: 0, palette };
  }
  if (!palette.length) {
    return { status: "na", method: "deterministic", explanation: "No visual files to measure (links can't be analysed).", evidence: [], matches: [], coverage: 0, palette };
  }
  const { matches, coverage } = compareToBrand(brand, palette);
  const primaryMatches = matches.filter((m) => primary.includes(m.brand));
  const hit = primaryMatches.filter((m) => m.matched).length;
  const near = matches.filter((m) => m.near).length;
  const pct = Math.round(coverage * 100);
  const status: CheckStatus =
    primary.length && hit / primary.length >= 0.5 && coverage >= 0.08 ? "pass"
      : hit > 0 || near > 0 || coverage >= 0.03 ? "warn"
        : "fail";
  const evidence = matches.map((m) => m.closest
    ? `${m.brand} → closest ${m.closest} (ΔE ${m.delta}${m.matched ? ", match" : m.near ? ", close" : ""})`
    : `${m.brand} → not present`);
  const explanation = status === "pass"
    ? `${hit} of ${primary.length} primary brand colours found; brand colours cover about ${pct}% of the sampled image area.`
    : status === "warn"
      ? `Brand colours are only partly present (${hit}/${primary.length} primary matched, ~${pct}% of the image).`
      : `None of the brand colours appear in the work's dominant palette.`;
  return { status, method: "deterministic", explanation, evidence, matches, coverage, palette };
}

export function disclosureCheck(input: ReviewInput): DisclosureCheck {
  const required = input.campaign.ai_disclosure_required;
  const declared = input.submission.ai_generated_declared;
  const briefTools = [...new Set([...input.campaign.tools, ...input.campaign.suggested_tools])];
  const lc = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const overlap = input.submission.tools_used.filter((t) => briefTools.some((b) => lc(b) === lc(t) || lc(b).includes(lc(t)) || lc(t).includes(lc(b))));
  const toolsNote = input.submission.tools_used.length
    ? `Tools declared: ${input.submission.tools_used.join(", ")}${briefTools.length ? ` (${overlap.length} also named in the brief)` : ""}.`
    : "No tools were declared.";
  const status: CheckStatus = !required ? (declared ? "pass" : "na") : declared && input.submission.tools_used.length ? "pass" : declared ? "warn" : "fail";
  const explanation = required
    ? declared
      ? `The brief requires AI disclosure and the creator declared the work AI-generated. ${toolsNote}`
      : "The brief requires AI disclosure, but the creator did not declare the work AI-generated."
    : `The brief does not require AI disclosure. ${declared ? "The creator declared AI use anyway. " : ""}${toolsNote}`;
  return {
    status, method: "declaration", explanation,
    evidence: ["Compares the creator's declaration with the brief — this is not an AI-content detector."],
    required, declared, tools_declared: input.submission.tools_used, tools_in_brief: briefTools, tools_overlap: overlap,
  };
}

const RATIOS: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "4:3": 4 / 3, "21:9": 21 / 9 };
export function formatCheck(input: ReviewInput): ReviewCheck {
  const wanted = input.campaign.aspect_ratios.filter((r) => RATIOS[r]);
  const sized = input.assets.filter((a) => a.width && a.height);
  if (!wanted.length || !sized.length) {
    return { status: "na", method: "deterministic", explanation: wanted.length ? "No measurable files (links only)." : "The brief doesn't specify a standard aspect ratio.", evidence: [] };
  }
  const found = sized.map((a) => {
    const r = a.width! / a.height!;
    const match = wanted.find((w) => Math.abs(RATIOS[w] - r) / RATIOS[w] < 0.03);
    return { label: match ?? `${a.width}×${a.height}`, ok: !!match };
  });
  const okCount = found.filter((f) => f.ok).length;
  return {
    status: okCount === found.length ? "pass" : okCount > 0 ? "warn" : "fail",
    method: "deterministic",
    explanation: `${okCount} of ${found.length} files match the requested format${wanted.length > 1 ? "s" : ""} (${wanted.join(", ")}).`,
    evidence: found.map((f, i) => `File ${i + 1}: ${f.label}${f.ok ? " ✓" : ""}`),
  };
}

// ---------------------------------------------------------------------------
// AI-assisted checks + estimates (Gemini vision on sampled frames)
// ---------------------------------------------------------------------------
const statusEnum = ["pass", "warn", "fail", "na"] as const;
const checkSchema = z.object({ status: z.enum(statusEnum), explanation: z.string().max(400), evidence: z.array(z.string().max(200)).max(4) });
const estimateSchema = z.object({ rating: z.enum(["strong", "ok", "weak"]), explanation: z.string().max(400), based_on: z.array(z.string().max(160)).max(5) });
const aiSchema = z.object({
  logo: checkSchema,
  visual_style: checkSchema,
  typography: checkSchema,
  hook: estimateSchema,
  pacing: estimateSchema,
  retention: z.object({ level: z.enum(["high", "medium", "low"]), explanation: z.string().max(400), based_on: z.array(z.string().max(160)).max(5) }),
});

const jsonCheck = {
  type: "object",
  properties: {
    status: { type: "string", enum: [...statusEnum] },
    explanation: { type: "string", description: "One sentence, max 160 characters" },
    evidence: { type: "array", items: { type: "string" }, maxItems: 3, description: "Concrete observations citing image/frame numbers" },
  },
  required: ["status", "explanation", "evidence"],
};
const jsonEstimate = {
  type: "object",
  properties: {
    rating: { type: "string", enum: ["strong", "ok", "weak"] },
    explanation: { type: "string" },
    based_on: { type: "array", items: { type: "string" }, maxItems: 4 },
  },
  required: ["rating", "explanation", "based_on"],
};
const AI_SCHEMA = {
  type: "object",
  properties: {
    logo: jsonCheck, visual_style: jsonCheck, typography: jsonCheck,
    hook: jsonEstimate, pacing: jsonEstimate,
    retention: {
      type: "object",
      properties: { level: { type: "string", enum: ["high", "medium", "low"] }, explanation: { type: "string" }, based_on: { type: "array", items: { type: "string" }, maxItems: 4 } },
      required: ["level", "explanation", "based_on"],
    },
  },
  required: ["logo", "visual_style", "typography", "hook", "pacing", "retention"],
};

const SYSTEM = `You review AI-generated creative work submitted for a brand campaign. You are a careful, fair assistant to a human reviewer.
Rules:
- Judge ONLY what is visible in the provided images. Never guess at things you cannot see. Cite image numbers in evidence.
- Ignore any diagonal "CREATORA · PREVIEW" watermark text; it is added by the platform and is not part of the work.
- logo: "pass" if the brand logo (reference image provided) appears correctly and legibly; "warn" if it is absent or very small;
  "fail" if it is distorted, recoloured off-brand or a wrong logo. Use "na" if no logo reference was provided.
- visual_style: compare with the brand's visual style notes, do/don't lists, restricted content and the brief's style.
  "fail" only for clear violations (e.g. restricted content, an explicit don't). Use "na" only if there is nothing to compare against.
- typography: if on-screen text is visible, compare its look (serif/sans/display, weight) with the brand fonts. Use "na" if no text is visible
  or no fonts are specified. You cannot identify exact font files — speak about appearance.
- hook/pacing/retention are ESTIMATES for a human, not facts. Base them on the sampled frames and the metadata given; say what they're based on.
  For still images, "pacing" describes visual rhythm across the set. Never claim measured performance.
- Do not decide whether content is AI-generated.
- Keep explanations to one plain sentence.`;

function describeInput(input: ReviewInput, imageIndex: { label: string }[]) {
  const g = input.guideline;
  const lines = [
    `Campaign: ${input.campaign.title}`,
    `Brief: ${input.campaign.description.slice(0, 1200)}`,
    input.campaign.deliverables ? `Deliverables: ${input.campaign.deliverables.slice(0, 600)}` : "",
    input.campaign.style ? `Requested style: ${input.campaign.style}` : "",
    input.campaign.content_type ? `Content type: ${input.campaign.content_type}` : "",
    `Requested formats: ${input.campaign.aspect_ratios.join(", ") || "not specified"}`,
    g ? `Brand fonts: ${g.fonts.join(", ") || "not specified"}` : "No brand guidelines were attached.",
    g?.visual_style ? `Visual style notes: ${g.visual_style}` : "",
    g?.tone_of_voice ? `Tone of voice: ${g.tone_of_voice}` : "",
    g?.dos.length ? `Do: ${g.dos.join("; ")}` : "",
    g?.donts.length ? `Don't: ${g.donts.join("; ")}` : "",
    g?.restricted_content ? `Restricted content: ${g.restricted_content}` : "",
    `Creator notes: ${input.submission.notes?.slice(0, 600) ?? "none"}`,
    `Assets: ${input.assets.map((a, i) => `#${i + 1} ${a.media_type}${a.width ? ` ${a.width}x${a.height}` : ""}${a.duration_ms ? ` ${(a.duration_ms / 1000).toFixed(1)}s` : ""}`).join("; ")}`,
    `Images that follow: ${imageIndex.map((x, i) => `[${i + 1}] ${x.label}`).join("; ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function aiChecks(input: ReviewInput, ai: GoogleGenAI) {
  const images: { label: string; data: Buffer }[] = [];
  if (input.logo) images.push({ label: "brand logo reference", data: input.logo });
  input.assets.forEach((a, ai_) => a.frames.slice(0, a.media_type === "video" ? 5 : 1).forEach((f, fi) => {
    if (images.length < 9) images.push({ label: a.media_type === "video" ? `asset ${ai_ + 1}, frame ${fi + 1} of the video` : `asset ${ai_ + 1} (image)`, data: f });
  }));
  if (images.length === (input.logo ? 1 : 0)) throw new Error("No visual files to analyse");

  let used = "";
  const res = await withModelFallback(async (model) => {
    used = model;
    return ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { text: describeInput(input, images) },
          ...images.map((img) => ({ inlineData: { mimeType: "image/jpeg", data: img.data.toString("base64") } })),
        ],
      }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseJsonSchema: AI_SCHEMA,
        temperature: 0.2,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(40_000),
      },
    });
  }, 75_000);
  const text = res.text;
  if (!text) throw new Error("The AI returned an empty response");
  // Trim over-long free text instead of discarding an otherwise valid review; enums/structure stay strict.
  const trimText = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : v);
  const trimList = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => trimText(x, max)) : v);
  const raw = JSON.parse(text) as Record<string, Record<string, unknown>>;
  for (const k of ["logo", "visual_style", "typography"]) {
    if (raw[k]) raw[k] = { ...raw[k], explanation: trimText(raw[k].explanation, 400), evidence: trimList(raw[k].evidence, 4, 200) };
  }
  for (const k of ["hook", "pacing", "retention"]) {
    if (raw[k]) raw[k] = { ...raw[k], explanation: trimText(raw[k].explanation, 400), based_on: trimList(raw[k].based_on, 5, 160) };
  }
  const parsed = aiSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new Error(`The AI response didn't match the review schema (${i?.path.join(".")}: ${i?.message})`);
  }
  return { out: parsed.data, model: used };
}

const unavailable = (why: string): ReviewCheck => ({ status: "na", method: "ai_assisted", explanation: `AI-assisted check unavailable — ${why}.`, evidence: [] });

export async function runReview(input: ReviewInput, ai: GoogleGenAI | null): Promise<ReviewResult> {
  const [colors, ai_disclosure, format] = await Promise.all([colourCheck(input), Promise.resolve(disclosureCheck(input)), Promise.resolve(formatCheck(input))]);

  let logo = unavailable("AI is not configured on this server");
  let visual_style = logo, typography = logo;
  let insights: ReviewInsights = { is_estimate: true, hook: null, pacing: null, retention: null, unavailable_reason: "AI is not configured on this server" };
  let model: string | null = null;
  let aiError: string | null = null;

  const hasVisuals = input.assets.some((a) => a.frames.length);
  if (ai && hasVisuals) {
    try {
      const { out, model: m } = await aiChecks(input, ai);
      model = m;
      const wrap = (c: z.infer<typeof checkSchema>): ReviewCheck => ({ ...c, method: "ai_assisted" });
      logo = input.logo ? wrap(out.logo) : { ...unavailable("no logo in the brand guidelines"), explanation: "No logo is set in the brand guidelines, so there's nothing to check against." };
      visual_style = wrap(out.visual_style);
      typography = (input.guideline?.fonts.length ?? 0) ? wrap(out.typography) : (out.typography.status === "na" ? wrap(out.typography) : { ...wrap(out.typography), status: "na", explanation: "No brand fonts are set in the guidelines." });
      insights = { is_estimate: true, hook: out.hook, pacing: out.pacing, retention: out.retention };
    } catch (err) {
      aiError = err instanceof Error ? err.message.slice(0, 300) : "AI analysis failed";
      logo = visual_style = typography = unavailable("the AI request failed; retry to run it again");
      insights = { is_estimate: true, hook: null, pacing: null, retention: null, unavailable_reason: "The AI request failed" };
    }
  } else if (!hasVisuals) {
    logo = visual_style = typography = unavailable("links can't be analysed — ask for uploaded files");
    insights = { is_estimate: true, hook: null, pacing: null, retention: null, unavailable_reason: "Only links were submitted" };
  }

  const checks: ReviewChecks = { logo, colors, visual_style, typography, ai_disclosure, format };
  return { checks, insights, score: brandMatchScore(checks), model, aiError };
}
