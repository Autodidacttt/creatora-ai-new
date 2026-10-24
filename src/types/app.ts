// Shapes of the JSON read models returned by Postgres RPCs (see supabase/migrations/0006_rpcs.sql).
import type { Badges } from "@/config/verification";

export type Role = "creator" | "brand" | "admin";
export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:5" | "4:3" | "21:9" | "custom";
export type ExperienceLevel = "emerging" | "intermediate" | "professional" | "expert";
export type Availability = "open" | "limited" | "booked";
export type CampaignStatus = "draft" | "active" | "completed";

export interface Named {
  id: number;
  name: string;
}
export interface ToolRef extends Named {
  verified?: boolean;
  category?: string;
  proficiency?: "learning" | "proficient" | "expert";
}

export interface SessionProfile {
  id: string;
  role: Role;
  username: string;
  display_name: string;
  avatar_url: string | null;
  onboarded: boolean;
  is_suspended: boolean;
  is_verified: boolean;
}

export interface MiniProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_verified: boolean;
  headline?: string | null;
  role?: Role;
  /** Phone / Identity / Company verification + brand type (0026) */
  badges?: Badges;
}

export interface CreatorCard {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  headline: string | null;
  location: string | null;
  is_verified: boolean;
  experience_level: ExperienceLevel | null;
  availability: Availability | null;
  followers_count: number;
  posts_count: number;
  likes_count: number;
  tools: ToolRef[];
  skills: Named[];
  categories: Named[];
  verified_count: number;
  badges?: Badges;
  preview: { id: string; media_type: "image" | "video" | "embed"; url: string | null; title: string; aspect_ratio: AspectRatio }[];
  is_following: boolean;
}

export interface WorkflowStep {
  tool_id: number | null;
  tool: string | null;
  step: string;
}

export interface PostCard {
  id: string;
  title: string;
  description: string | null;
  media_type: "image" | "video" | "embed";
  media_url: string | null;
  thumbnail_url: string | null;
  source_link: string | null;
  embed_provider: "youtube" | "vimeo" | "instagram" | "behance" | "tiktok" | "other" | null;
  aspect_ratio: AspectRatio;
  commercial_use_cleared: boolean;
  workflow_notes: string | null;
  workflow_steps: WorkflowStep[];
  likes_count: number;
  comments_count: number;
  saves_count: number;
  is_removed: boolean;
  created_at: string;
  content_type: Named | null;
  style: Named | null;
  category: Named | null;
  tools: Named[];
  creator: MiniProfile;
  liked: boolean;
  saved: boolean;
  workflow_verified: boolean;
}

export interface CampaignCard {
  id: string;
  brand_id: string;
  title: string;
  description: string;
  deliverables: string | null;
  content_type_id: number | null;
  style_id: number | null;
  category_id: number | null;
  aspect_ratios: AspectRatio[];
  custom_aspect: string | null;
  target_audience: string | null;
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
  ai_assisted: boolean;
  status: CampaignStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  brand: MiniProfile & { company_name: string | null; industry: string | null };
  content_type: Named | null;
  style: Named | null;
  category: Named | null;
  platforms: Named[];
  tools: Named[];
  skills: Named[];
  languages: Named[];
  stats: { applications: number; shortlisted: number; selected: number } | null;
  my_application: { id: string; status: "pending" | "rejected" | "withdrawn"; created_at: string } | null;
  my_shortlisted: boolean;
  my_selected: boolean;
  saved: boolean;
  /** The caller's own project on this brief (creators), if any */
  my_project?: { id: string; status: string } | null;
  is_sprint?: boolean;
  sprint_deadline?: string | null;
  sprint_closed?: boolean;
  guideline_id?: string | null;
  suggested_tools?: string[];
  production_notes?: { camera?: string; lighting?: string; style?: string; format?: string };
  ip_terms?: { notes?: string };
  ai_brief?: Record<string, unknown> | null;
  /** Studio inputs — only returned to the owning brand */
  source_idea?: string | null;
  source_url?: string | null;
  source_summary?: string | null;
  studio_step?: number;
}

export interface ScoreBreakdown {
  [factor: string]: { score: number; max: number };
}

export interface RankedCreator {
  creator: CreatorCard;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  total_count: number;
}

export interface Verification {
  id: string;
  /** past_work = evidence-based request; identity = legacy manual request (ID verification has its own flow) */
  type: "past_work" | "identity";
  title: string;
  status: "pending" | "approved" | "rejected";
  evidence_url: string | null;
  evidence_notes: string | null;
  experience_id: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface Experience {
  id: string;
  brand_name: string;
  project_title: string;
  year: number | null;
  description: string | null;
  link: string | null;
  verified: boolean;
}

export interface FullProfile {
  id: string;
  role: Role;
  username: string;
  display_name: string;
  avatar_url: string | null;
  cover_url: string | null;
  headline: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  links: Record<string, string>;
  is_verified: boolean;
  is_suspended: boolean;
  badges?: Badges;
  onboarded: boolean;
  created_at: string;
  stats: { followers: number; following: number; posts: number; likes: number };
  creator: {
    experience_level: ExperienceLevel;
    availability: Availability;
    years_experience: number | null;
    rate_min: number | null;
    rate_max: number | null;
    currency: string;
    workflow_overview: string | null;
  } | null;
  brand: { company_name: string; industry: string | null; company_size: string | null; description: string | null } | null;
  tools: ToolRef[];
  skills: Named[];
  categories: Named[];
  content_types: Named[];
  styles: Named[];
  languages: Named[];
  platforms: Named[];
  experiences: Experience[];
  verifications: Verification[];
  is_me: boolean;
  is_following: boolean;
  follows_you: boolean;
}

export interface InboxItem {
  conversation_id: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_sender_id: string | null;
  unread_count: number;
  /** For a group chat this is the brief (role "group"), not a person */
  other: MiniProfile & { role: Role | "group" };
  total_count: number;
  conversation_type: "direct" | "group";
  campaign: { id: string; title: string; status: string } | null;
}

export interface ConversationInfo {
  id: string;
  type: "direct" | "group";
  campaign: { id: string; title: string; status: string; brand_id: string } | null;
  members: (MiniProfile & { role: Role })[];
}

/** agreed = both accepted the same offer (brand can hire) · awaiting_funding = hired, brand must fund · hired = funded / under way */
export type NegotiationState = "open" | "negotiating" | "agreed" | "awaiting_funding" | "hired";

export interface Negotiation {
  state: NegotiationState;
  brand_id: string;
  creator_id: string;
  campaign: {
    id: string; title: string; status: string; description: string; deliverables: string | null;
    budget_min: number | null; budget_max: number | null; currency: string; deadline: string | null;
    usage_rights: string[]; creators_needed: number; is_sprint: boolean;
  };
  application: { proposed_rate: number | null; status: string } | null;
  latest_offer: (MessagePayload & { message_id: string; sender_id: string }) | null;
  proposal: { id: string; version: number; status: string; price: number; currency: string; terms: OfferTerms; note: string | null; sent_at: string | null } | null;
  project: { id: string; status: string; escrow_status: string | null } | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  /**
   * The message type: "user" = plain text; "system" = automatic update posted by the platform;
   * "offer" / "proposal" / "task" = structured cards whose data is in payload (written only by RPCs).
   */
  kind?: "user" | "system" | "offer" | "proposal" | "task";
  payload?: MessagePayload | null;
  pending?: boolean;
}

export interface OfferTerms {
  deliverables: string;
  deadline: string | null;
  usage_rights: string[];
}

export interface MessagePayload {
  /** offer / proposal */
  price?: number;
  currency?: string;
  terms?: OfferTerms;
  status?: string;
  by?: "brand" | "creator";
  proposal_id?: string;
  version?: number;
  note?: string | null;
  /** task */
  task_id?: string;
  title?: string;
  due_date?: string | null;
  scope?: "individual" | "group";
}

export interface NotificationItem {
  id: string;
  type: "follow" | "like" | "comment" | "application" | "shortlisted" | "selected" | "message" | "verification"
    | "project" | "payment" | "opportunity" | "proposal" | "task";
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, string | number | boolean | null | undefined | string[]>;
  read_at: string | null;
  created_at: string;
  actor: MiniProfile | null;
}

export interface LookupItem extends Named {
  slug: string;
  category?: string;
}

export interface Lookups {
  skills: LookupItem[];
  ai_tools: LookupItem[];
  categories: LookupItem[];
  content_types: LookupItem[];
  styles: LookupItem[];
  platforms: LookupItem[];
  languages: LookupItem[];
}
