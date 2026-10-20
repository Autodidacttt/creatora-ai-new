// Shapes of the JSON read models returned by Postgres RPCs (see supabase/migrations/0006_rpcs.sql).

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
  type: "tool" | "workflow" | "past_work" | "identity";
  title: string;
  status: "pending" | "approved" | "rejected";
  evidence_url: string | null;
  evidence_notes: string | null;
  tool_id: number | null;
  post_id: string | null;
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
  other: MiniProfile & { role: Role };
  total_count: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  pending?: boolean;
}

export interface NotificationItem {
  id: string;
  type: "follow" | "like" | "comment" | "application" | "shortlisted" | "selected" | "message" | "verification";
  entity_type: string | null;
  entity_id: string | null;
  data: Record<string, string | number | undefined>;
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
