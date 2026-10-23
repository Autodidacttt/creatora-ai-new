// Read models for the brand workspace + creator projects (shapes of the JSON returned by 0017 RPCs).
import type { CampaignCard, CreatorCard, MiniProfile } from "./app";
import type { ReviewChecks, ReviewInsights } from "@/lib/review/ai-review";

export type ProjectStatus =
  | "applied" | "shortlisted" | "hired" | "in_progress" | "submitted" | "revision_requested" | "resubmitted"
  | "approved" | "completed" | "rejected" | "cancelled";
export type SubmissionStatus = "draft" | "submitted" | "revision_requested" | "approved" | "rejected";
export type EscrowStatus = "unfunded" | "funded" | "released" | "refunded" | "disputed";
export type AiStatus = "pending" | "running" | "done" | "failed";

export interface PartyProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
  role: "creator" | "brand" | "admin";
  company_name: string | null;
}

export interface Escrow {
  id: string;
  status: EscrowStatus;
  amount: number;
  currency: string;
  platform_fee: number;
  provider: "internal" | "stripe_test";
  funded_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  disputed_at: string | null;
}

export interface ProjectSummary {
  id: string;
  status: ProjectStatus;
  campaign_id: string;
  creator_id: string;
  agreed_amount: number | null;
  currency: string;
  payment_status: "pending" | "paid";
  paid_at: string | null;
  hired_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  status_changed_at: string;
  created_at: string;
  campaign: {
    id: string;
    title: string;
    status: string;
    deadline: string | null;
    is_sprint: boolean;
    sprint_deadline: string | null;
    sprint_closed: boolean;
    budget_min: number | null;
    budget_max: number | null;
    currency: string;
    brand: PartyProfile;
  };
  creator: PartyProfile;
  escrow: Escrow | null;
  latest_submission: { id: string; version: number; status: SubmissionStatus; submitted_at: string | null; reviewed_at: string | null } | null;
  certificate_id: string | null;
}

export interface SubmissionFile {
  id: string;
  submission_id: string;
  position: number;
  kind: "upload" | "link";
  media_type: "image" | "video" | "link";
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
  preview_path: string | null;
  thumbnail_path: string | null;
  frame_paths: string[];
  preview_kind: "image_watermark" | "video_ffmpeg" | "video_frames" | "external_link" | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sha256: string | null;
  link_url: string | null;
  palette: string[];
  created_at: string;
}

export interface SubmissionReview {
  id: string;
  decision: "approved" | "revision_requested" | "rejected";
  feedback: string | null;
  created_at: string;
  reviewer: PartyProfile;
}

export interface SubmissionComment {
  id: string;
  body: string;
  timestamp_ms: number | null;
  file_id: string | null;
  created_at: string;
  author: PartyProfile;
}

export interface Submission {
  id: string;
  project_id: string;
  campaign_id: string;
  creator_id: string;
  version: number;
  status: SubmissionStatus;
  notes: string | null;
  tools_used: string[];
  workflow_notes: string | null;
  ai_generated_declared: boolean;
  commercial_terms_accepted: boolean;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  files: SubmissionFile[];
  reviews: SubmissionReview[];
  comments: SubmissionComment[];
}

export interface ProjectEvent {
  id: string;
  kind: "status" | "payment" | "certificate" | "comment";
  event: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  data: Record<string, unknown>;
  created_at: string;
  actor: PartyProfile | null;
}

export interface PaymentEvent {
  id: number;
  event: string;
  from_status: string | null;
  to_status: string;
  amount: number;
  currency: string;
  note: string | null;
  created_at: string;
}

export interface Guideline {
  id: string;
  brand_id: string;
  name: string;
  logo_url: string | null;
  primary_colors: string[];
  secondary_colors: string[];
  fonts: string[];
  tone_of_voice: string | null;
  visual_style: string | null;
  dos: string[];
  donts: string[];
  restricted_content: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectReview {
  id: string;
  author_id: string;
  subject_id: string;
  rating: number;
  body: string | null;
  created_at: string;
  author: PartyProfile;
}

export interface ProjectDetail extends ProjectSummary {
  role: "creator" | "brand" | "admin";
  campaign_card: CampaignCard & { my_project?: { id: string; status: ProjectStatus } | null };
  guideline: Guideline | null;
  events: ProjectEvent[];
  payments: PaymentEvent[];
  submissions: Submission[];
  reviews: ProjectReview[];
}

export interface AiReviewRow {
  submission_id: string;
  status: AiStatus;
  brand_match_score: number | null;
  checks: Partial<ReviewChecks>;
  insights: Partial<ReviewInsights>;
  model_name: string | null;
  error: string | null;
  attempts: number;
  updated_at: string;
}

export interface SubmissionDetail extends Submission {
  creator: PartyProfile;
  project: ProjectSummary;
  versions: { id: string; version: number; status: SubmissionStatus; submitted_at: string | null }[];
  ai: AiReviewRow | null;
  campaign: {
    id: string;
    title: string;
    ai_disclosure_required: boolean;
    aspect_ratios: string[];
    is_sprint: boolean;
    sprint_deadline: string | null;
    tools: string[];
    suggested_tools: string[];
  };
  guideline: Guideline | null;
}

export interface ReviewInboxItem {
  id: string;
  version: number;
  status: SubmissionStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  project_id: string;
  project_status: ProjectStatus;
  hired: boolean;
  is_latest: boolean;
  campaign: { id: string; title: string; is_sprint: boolean };
  creator: PartyProfile;
  files_count: number;
  cover: { media_type: "image" | "video" | "link"; preview_path: string | null; thumbnail_path: string | null; preview_kind: string | null; link_url: string | null } | null;
  ai: { status: AiStatus; score: number | null } | null;
}

export interface HiringCandidate {
  creator: CreatorCard;
  application: { id: string; pitch: string; proposed_rate: number | null; status: "pending" | "rejected" | "withdrawn"; created_at: string } | null;
  shortlisted: boolean;
  project: ProjectSummary | null;
  latest_work: {
    submission_id: string;
    version: number;
    status: SubmissionStatus;
    submitted_at: string | null;
    files: { media_type: "image" | "video" | "link"; preview_path: string | null; thumbnail_path: string | null; preview_kind: string | null; frame_paths: string[]; link_url: string | null }[];
    ai_score: number | null;
  } | null;
}

export interface BrandSprint {
  id: string;
  title: string;
  description: string;
  status: string;
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  sprint_deadline: string;
  closed: boolean;
  created_at: string;
  entrants: number;
  submissions: number;
  pending_review: number;
  hired: number;
}

export interface BrandOverview {
  campaigns: number;
  active_campaigns: number;
  drafts: number;
  creators_hired: number;
  active_projects: number;
  pending_reviews: number;
  awaiting_payment: number;
  unread_messages: number;
  activity: {
    created_at: string;
    kind: "status" | "payment" | "certificate" | "comment" | "application";
    event: string;
    project_id: string | null;
    data: Record<string, unknown>;
    campaign_title: string;
    campaign_id: string;
    actor: PartyProfile | null;
  }[];
  deadlines: { campaign_id: string; title: string; is_sprint: boolean; due_at: string; open_projects: number }[];
}

// ---------------------------------------------------------------------------
// Collaborators (hired creators on a brief), group chat and tasks
// ---------------------------------------------------------------------------
export type TaskStatus = "todo" | "in_progress" | "done";

export interface CampaignTask {
  id: string;
  campaign_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  scope: "individual" | "group";
  assigned_to: string | null;
  status: TaskStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignee?: MiniProfile | null;
}

export interface Collaborators {
  campaign: { id: string; title: string; status: string; creators_needed: number };
  count: number;
  /** Only when the viewer is in the group */
  group_conversation_id: string | null;
  members: {
    creator: MiniProfile;
    project_id: string;
    status: ProjectStatus;
    hired_at: string;
    /** Brand only */
    agreed_amount: number | null;
    currency: string;
    conversation_id: string | null;
  }[];
  tasks: CampaignTask[];
}
