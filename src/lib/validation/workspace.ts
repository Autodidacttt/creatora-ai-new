// Zod schemas for the brand workspace + creator submissions. Shared by client forms and route handlers.
import { z } from "zod";
import { CURRENCIES } from "@/config/constants";

const RIGHTS = ["organic_social", "paid_social", "broadcast", "ooh", "web", "internal"] as const;
const DURATIONS = ["3_months", "6_months", "12_months", "24_months", "perpetual"] as const;
const EXCL = ["none", "category", "full"] as const;
const LICENCES = ["non_exclusive", "exclusive", "buyout", "limited"] as const;
export const STUDIO_ASPECTS = ["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"] as const;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #F5A800").transform((v) => v.toUpperCase());
const shortList = (max: number, each: number) => z.array(z.string().trim().min(1).max(each)).max(max);

// ---------------------------------------------------------------------------
// Campaign Studio — the structured brief (AI output and the inline editor share this shape)
// ---------------------------------------------------------------------------
export const BRIEF_SECTIONS = ["overview", "deliverables", "budget", "requirements", "tools", "production", "ip"] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number];

export const studioBriefSchema = z.object({
  title: z.string().trim().min(3, "At least 3 characters").max(140),
  objective: z.string().trim().min(5, "Say what this campaign should achieve").max(600),
  summary: z.string().trim().min(10, "Describe the concept for creators (10+ characters)").max(2000),
  audience: z.string().trim().max(500),
  tone: z.string().trim().max(300),
  deliverables: shortList(12, 200).min(1, "List at least one deliverable"),
  content_type: z.string().nullable(),
  style: z.string().nullable(),
  category: z.string().nullable(),
  platforms: z.array(z.string()).max(6),
  aspect_ratios: z.array(z.enum(STUDIO_ASPECTS)).min(1, "Pick at least one format").max(4),
  timeline: z.string().trim().max(300),
  deadline_days: z.number().int().min(1).max(365).nullable(),
  budget: z.object({
    min: z.number().int().min(0).nullable(),
    max: z.number().int().min(0).nullable(),
    currency: z.enum(CURRENCIES),
    guidance: z.string().trim().max(400),
  }).refine((b) => b.min == null || b.max == null || b.max >= b.min, { message: "Max must be at least min", path: ["max"] }),
  requirements: shortList(12, 240),
  suggested_tools: shortList(10, 80),
  production: z.object({
    camera: z.string().trim().max(400),
    lighting: z.string().trim().max(400),
    style: z.string().trim().max(400),
    format: z.string().trim().max(400),
  }),
  ip: z.object({
    usage_rights: z.array(z.enum(RIGHTS)).max(6),
    territory: z.string().trim().min(1).max(80),
    usage_duration: z.enum(DURATIONS),
    exclusivity: z.enum(EXCL),
    license_type: z.enum(LICENCES),
    ai_disclosure_required: z.boolean(),
    notes: z.string().trim().max(600),
  }),
  creators_needed: z.number().int().min(1).max(50),
});
export type StudioBrief = z.infer<typeof studioBriefSchema>;

/** Which brief fields each "Regenerate" button replaces. */
export const SECTION_FIELDS: Record<BriefSection, (keyof StudioBrief)[]> = {
  overview: ["title", "objective", "summary", "audience", "tone", "content_type", "style", "category"],
  deliverables: ["deliverables", "platforms", "aspect_ratios", "timeline", "deadline_days", "creators_needed"],
  budget: ["budget"],
  requirements: ["requirements"],
  tools: ["suggested_tools"],
  production: ["production"],
  ip: ["ip"],
};

export const studioBriefRequestSchema = z.object({
  idea: z.string().trim().max(4000).default(""),
  link_summary: z.string().trim().max(3000).nullable().optional(),
  section: z.enum(BRIEF_SECTIONS).nullable().optional(),
  current: z.unknown().optional(),
}).refine((v) => v.idea.length >= 10 || (v.link_summary?.length ?? 0) >= 10, {
  message: "Describe your idea in a sentence or two, or add a link",
  path: ["idea"],
});

const httpUrl = z.string().trim().max(1000).regex(/^https?:\/\/\S+\.\S+/i, "Enter a full URL starting with https://");

export const linkRequestSchema = z.object({ url: httpUrl });

// ---------------------------------------------------------------------------
// Brand guidelines
// ---------------------------------------------------------------------------
export const guidelineSchema = z.object({
  name: z.string().trim().min(1).max(80),
  logo_url: z.string().trim().max(1000).nullable(),
  primary_colors: z.array(hex).max(8),
  secondary_colors: z.array(hex).max(8),
  fonts: shortList(6, 60),
  tone_of_voice: z.string().trim().max(1000).nullable(),
  visual_style: z.string().trim().max(2000).nullable(),
  dos: shortList(12, 200),
  donts: shortList(12, 200),
  restricted_content: z.string().trim().max(1000).nullable(),
});
export type GuidelineInput = z.infer<typeof guidelineSchema>;

// ---------------------------------------------------------------------------
// Hiring, sprints, payments
// ---------------------------------------------------------------------------
export const hireSchema = z.object({
  amount: z.coerce.number().int("Whole amounts only").min(1, "Enter the agreed amount").max(10_000_000),
  currency: z.enum(CURRENCIES),
});

export const sprintSchema = z.object({
  title: z.string().trim().min(3, "At least 3 characters").max(140),
  description: z.string().trim().min(10, "Describe what you need (10+ characters)").max(2000),
  deliverables: z.string().trim().max(1000).optional().transform((v) => v || null),
  budget: z.coerce.number().int().min(1, "Set the fixed budget").max(1_000_000),
  currency: z.enum(CURRENCIES),
  hours: z.coerce.number().int().min(2).max(72).default(48),
  aspect_ratios: z.array(z.enum(STUDIO_ASPECTS)).min(1, "Pick at least one format"),
});
export type SprintInput = z.infer<typeof sprintSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(5, "Add a short reason").max(1000) });

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------
export const MAX_FILES_PER_SUBMISSION = 10;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const SUBMISSION_MIME = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"] as const;

export const submissionUploadSchema = z.object({
  kind: z.literal("upload"),
  path: z.string().min(10).max(500),
  name: z.string().trim().min(1).max(200),
  mime: z.enum(SUBMISSION_MIME),
  position: z.number().int().min(0).max(50),
  frames: z.array(z.string().max(500)).max(8).default([]),
  meta: z.object({
    width: z.number().int().min(1).max(20000).optional(),
    height: z.number().int().min(1).max(20000).optional(),
    duration_ms: z.number().int().min(0).max(36_000_000).optional(),
  }).default({}),
});
export const submissionLinkSchema = z.object({
  kind: z.literal("link"),
  url: httpUrl,
  position: z.number().int().min(0).max(50),
});
export const submissionFileSchema = z.discriminatedUnion("kind", [submissionUploadSchema, submissionLinkSchema]);

export const submissionDetailsSchema = z.object({
  notes: z.string().trim().max(4000).nullable(),
  tools_used: shortList(20, 80),
  workflow_notes: z.string().trim().max(4000).nullable(),
  ai_generated_declared: z.literal(true, { error: "Confirm the work is AI-generated as declared" }),
  commercial_terms_accepted: z.literal(true, { error: "Confirm the work meets the brief's commercial-use terms" }),
});
export type SubmissionDetails = z.infer<typeof submissionDetailsSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(["approved", "revision_requested", "rejected"]),
  feedback: z.string().trim().max(4000).optional().transform((v) => v || null),
}).refine((v) => v.decision === "approved" || (v.feedback?.length ?? 0) >= 5, {
  message: "Tell the creator what to change (5+ characters)",
  path: ["feedback"],
});

export const commentInputSchema = z.object({
  body: z.string().trim().min(1, "Write a comment").max(2000),
  timestamp_ms: z.number().int().min(0).max(36_000_000).nullable(),
  file_id: z.string().uuid().nullable(),
});

export const projectReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  body: z.string().trim().max(1500).optional().transform((v) => v || null),
});
