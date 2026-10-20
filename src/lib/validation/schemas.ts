import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const optionalUrl = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^https?:\/\/\S+\.\S+/.test(v), "Enter a full URL starting with https://");

export const aspectRatioSchema = z.enum(["16:9", "9:16", "1:1", "4:5", "4:3", "21:9", "custom"]);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const signInSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export const signUpSchema = z.object({
  role: z.enum(["creator", "brand"]),
  displayName: z.string().trim().min(2, "At least 2 characters").max(80),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters").max(72),
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const profileSchema = z.object({
  display_name: z.string().trim().min(1, "Required").max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,30}$/, "3–30 characters: letters, numbers, dots, underscores"),
  headline: optionalText(140),
  bio: optionalText(1200),
  location: optionalText(80),
  website: optionalUrl,
  links: z.record(z.string(), z.string().trim().max(300)).default({}),
});
export type ProfileInput = z.output<typeof profileSchema>;

export const creatorDetailsSchema = z
  .object({
    experience_level: z.enum(["emerging", "intermediate", "professional", "expert"]),
    availability: z.enum(["open", "limited", "booked"]),
    years_experience: z.coerce.number().int().min(0).max(60).nullable().optional(),
    rate_min: z.coerce.number().int().min(0).nullable().optional(),
    rate_max: z.coerce.number().int().min(0).nullable().optional(),
    currency: z.string().length(3),
    workflow_overview: optionalText(2000),
  })
  .refine((v) => v.rate_min == null || v.rate_max == null || v.rate_max >= v.rate_min, {
    message: "Max rate must be at least the min rate",
    path: ["rate_max"],
  });

export const creatorAttributesSchema = z.object({
  tools: z.array(z.object({ id: z.number().int(), proficiency: z.enum(["learning", "proficient", "expert"]) })).max(30),
  skills: z.array(z.number().int()).max(30),
  categories: z.array(z.number().int()).max(10),
  content_types: z.array(z.number().int()).max(15),
  styles: z.array(z.number().int()).max(15),
  languages: z.array(z.number().int()).max(15),
  platforms: z.array(z.number().int()).max(15),
});
export type CreatorAttributes = z.infer<typeof creatorAttributesSchema>;

export const brandDetailsSchema = z.object({
  company_name: z.string().trim().min(1, "Required").max(120),
  industry: optionalText(80),
  company_size: z.enum(["1-10", "11-50", "51-200", "201-1000", "1000+"]).nullable().optional(),
  description: optionalText(2000),
});

export const experienceSchema = z.object({
  brand_name: z.string().trim().min(1, "Required").max(120),
  project_title: z.string().trim().min(1, "Required").max(160),
  year: z.coerce.number().int().min(1990).max(2100).nullable().optional(),
  description: optionalText(1000),
  link: optionalUrl,
});

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------
export const postSchema = z
  .object({
    title: z.string().trim().min(1, "Give your piece a title").max(120),
    description: optionalText(2000),
    media_type: z.enum(["image", "video", "embed"]),
    media_url: z.string().trim().max(1000).nullable().optional(),
    thumbnail_url: z.string().trim().max(1000).nullable().optional(),
    source_link: z.string().trim().max(1000).nullable().optional(),
    embed_provider: z.enum(["youtube", "vimeo", "instagram", "behance", "tiktok", "other"]).nullable().optional(),
    content_type_id: z.number().int().nullable(),
    style_id: z.number().int().nullable(),
    category_id: z.number().int().nullable(),
    aspect_ratio: aspectRatioSchema,
    commercial_use_cleared: z.boolean(),
    workflow_notes: optionalText(2000),
    workflow_steps: z
      .array(z.object({ tool_id: z.number().int().nullable(), step: z.string().trim().min(1).max(120) }))
      .max(12),
    tool_ids: z.array(z.number().int()).min(1, "Pick at least one AI tool or model").max(15),
  })
  .refine((v) => v.media_url || v.source_link, { message: "Upload a file or paste a link", path: ["media_url"] });
export type PostInput = z.output<typeof postSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1, "Write something").max(1000) });

// ---------------------------------------------------------------------------
// Campaigns / briefs
// ---------------------------------------------------------------------------
export const campaignSchema = z
  .object({
    title: z.string().trim().min(3, "At least 3 characters").max(140),
    description: z.string().trim().min(10, "Describe the brief in at least 10 characters").max(4000),
    deliverables: optionalText(2000),
    content_type_id: z.number().int().nullable(),
    style_id: z.number().int().nullable(),
    category_id: z.number().int().nullable(),
    aspect_ratios: z.array(aspectRatioSchema).min(1, "Pick at least one format"),
    custom_aspect: optionalText(40),
    target_audience: optionalText(500),
    budget_min: z.coerce.number().int().min(0).nullable(),
    budget_max: z.coerce.number().int().min(0).nullable(),
    currency: z.string().length(3),
    deadline: z.string().nullable(),
    creators_needed: z.coerce.number().int().min(1).max(50),
    usage_rights: z.array(z.enum(["organic_social", "paid_social", "broadcast", "ooh", "web", "internal"])),
    territory: z.string().trim().min(1).max(80),
    usage_duration: z.enum(["3_months", "6_months", "12_months", "24_months", "perpetual"]),
    exclusivity: z.enum(["none", "category", "full"]),
    license_type: z.enum(["non_exclusive", "exclusive", "buyout", "limited"]),
    ai_disclosure_required: z.boolean(),
    ai_assisted: z.boolean(),
    status: z.enum(["draft", "active", "completed"]),
    platform_ids: z.array(z.number().int()),
    tool_ids: z.array(z.number().int()),
    skill_ids: z.array(z.number().int()),
    language_ids: z.array(z.number().int()),
  })
  .refine((v) => v.budget_min == null || v.budget_max == null || v.budget_max >= v.budget_min, {
    message: "Max budget must be at least the min budget",
    path: ["budget_max"],
  })
  .refine((v) => !v.aspect_ratios.includes("custom") || !!v.custom_aspect, {
    message: "Describe the custom format",
    path: ["custom_aspect"],
  })
  .refine((v) => v.status === "draft" || v.usage_rights.length > 0, {
    message: "Pick at least one usage right before publishing",
    path: ["usage_rights"],
  });
export type CampaignInput = z.output<typeof campaignSchema>;

export const applicationSchema = z.object({
  pitch: z.string().trim().min(10, "Tell the brand why you're a fit (10+ characters)").max(1500),
  proposed_rate: z.coerce.number().int().min(0).nullable().optional(),
});

export const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const verificationRequestSchema = z
  .object({
    type: z.enum(["tool", "workflow", "past_work", "identity"]),
    tool_id: z.number().int().nullable().optional(),
    post_id: z.string().uuid().nullable().optional(),
    experience_id: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(3).max(160),
    evidence_url: optionalUrl,
    evidence_notes: optionalText(2000),
  })
  .refine((v) => v.type !== "tool" || v.tool_id, { message: "Choose a tool", path: ["tool_id"] })
  .refine((v) => v.type !== "workflow" || v.post_id, { message: "Choose a portfolio piece", path: ["post_id"] })
  .refine((v) => v.type !== "past_work" || v.experience_id, { message: "Choose a past project", path: ["experience_id"] });

export const reportSchema = z.object({
  target_type: z.enum(["profile", "post", "comment", "campaign", "message"]),
  target_id: z.string().uuid(),
  reason: z.enum(["spam", "harassment", "ip_infringement", "misleading", "inappropriate", "other"]),
  details: optionalText(1000),
});

// ---------------------------------------------------------------------------
// Admin actions (validated server-side in /api/admin)
// ---------------------------------------------------------------------------
export const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_verified"), user_id: z.string().uuid(), value: z.boolean() }),
  z.object({ action: z.literal("set_suspended"), user_id: z.string().uuid(), value: z.boolean() }),
  z.object({
    action: z.literal("review_verification"),
    verification_id: z.string().uuid(),
    status: z.enum(["approved", "rejected"]),
    notes: z.string().trim().max(1000).optional(),
  }),
  z.object({ action: z.literal("set_post_removed"), post_id: z.string().uuid(), value: z.boolean() }),
  z.object({ action: z.literal("resolve_report"), report_id: z.string().uuid(), status: z.enum(["resolved", "dismissed"]) }),
]);
export type AdminAction = z.infer<typeof adminActionSchema>;

export const briefPromptSchema = z.object({ prompt: z.string().trim().min(10, "Describe your idea in a sentence or two").max(2000) });
