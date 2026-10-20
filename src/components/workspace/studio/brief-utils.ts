import type { Lookups } from "@/types/app";
import type { StudioIds } from "@/services/workspace";
import { studioBriefSchema, type StudioBrief } from "@/lib/validation/workspace";

/** Starting point for the manual form (used when the AI is unavailable or the brand skips it). */
export function emptyBrief(idea: string): StudioBrief {
  const first = idea.split(/[.\n]/)[0]?.trim() ?? "";
  return {
    title: first.slice(0, 100),
    objective: "",
    summary: idea.slice(0, 2000),
    audience: "",
    tone: "",
    deliverables: [""],
    content_type: null,
    style: null,
    category: null,
    platforms: [],
    aspect_ratios: ["9:16"],
    timeline: "",
    deadline_days: 14,
    budget: { min: null, max: null, currency: "USD", guidance: "" },
    requirements: [],
    suggested_tools: [],
    production: { camera: "", lighting: "", style: "", format: "" },
    ip: {
      usage_rights: ["organic_social"], territory: "Worldwide", usage_duration: "12_months", exclusivity: "none",
      license_type: "non_exclusive", ai_disclosure_required: true, notes: "",
    },
    creators_needed: 1,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Brief names → lookup ids for the campaign columns that ranking and discovery use. */
export function mapIds(b: StudioBrief | null, l: Lookups | undefined): StudioIds {
  if (!b || !l) return { content_type_id: null, style_id: null, category_id: null, platform_ids: [], tool_ids: [] };
  const by = (list: { id: number; name: string }[], name: string | null) => (name ? list.find((x) => norm(x.name) === norm(name))?.id ?? null : null);
  const tools = b.suggested_tools
    .map((t) => l.ai_tools.find((x) => norm(x.name) === norm(t) || norm(t).includes(norm(x.name)) || norm(x.name).includes(norm(t)))?.id)
    .filter((x): x is number => !!x);
  return {
    content_type_id: by(l.content_types, b.content_type),
    style_id: by(l.styles, b.style),
    category_id: by(l.categories, b.category),
    platform_ids: b.platforms.map((p) => by(l.platforms, p)).filter((x): x is number => !!x),
    tool_ids: [...new Set(tools)],
  };
}

/** First validation problem as a readable sentence, or null when the brief is complete. */
export function briefProblem(b: StudioBrief | null): string | null {
  if (!b) return "Generate or write the brief first.";
  const clean = { ...b, deliverables: b.deliverables.filter((d) => d.trim()), requirements: b.requirements.filter((r) => r.trim()) };
  const r = studioBriefSchema.safeParse(clean);
  if (r.success) return null;
  const i = r.error.issues[0];
  return `${i.path.join(" › ") || "Brief"}: ${i.message}`;
}

export function cleanBrief(b: StudioBrief): StudioBrief {
  return { ...b, deliverables: b.deliverables.filter((d) => d.trim()), requirements: b.requirements.filter((r) => r.trim()) };
}
