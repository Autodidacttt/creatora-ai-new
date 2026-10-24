import type { AspectRatio, Availability, ExperienceLevel } from "@/types/app";

export const ASPECT_RATIOS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: "16:9", label: "16:9", hint: "Landscape · YouTube, CTV" },
  { value: "9:16", label: "9:16", hint: "Vertical · Reels, TikTok, Shorts" },
  { value: "1:1", label: "1:1", hint: "Square · Feed" },
  { value: "4:5", label: "4:5", hint: "Portrait · Instagram feed" },
  { value: "4:3", label: "4:3", hint: "Classic" },
  { value: "21:9", label: "21:9", hint: "Cinemascope" },
  { value: "custom", label: "Custom", hint: "Specify below" },
];

export const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: "emerging", label: "Emerging" },
  { value: "intermediate", label: "Intermediate" },
  { value: "professional", label: "Professional" },
  { value: "expert", label: "Expert" },
];

export const AVAILABILITY: { value: Availability; label: string; dot: string }[] = [
  { value: "open", label: "Available", dot: "bg-emerald-500" },
  { value: "limited", label: "Limited", dot: "bg-amber-500" },
  { value: "booked", label: "Booked", dot: "bg-rose-500" },
];

export const USAGE_RIGHTS = [
  { value: "organic_social", label: "Organic social" },
  { value: "paid_social", label: "Paid social" },
  { value: "broadcast", label: "Broadcast / CTV" },
  { value: "ooh", label: "Out-of-home" },
  { value: "web", label: "Web & e-commerce" },
  { value: "internal", label: "Internal only" },
] as const;

export const USAGE_DURATIONS = [
  { value: "3_months", label: "3 months" },
  { value: "6_months", label: "6 months" },
  { value: "12_months", label: "12 months" },
  { value: "24_months", label: "24 months" },
  { value: "perpetual", label: "Perpetual" },
] as const;

export const EXCLUSIVITY = [
  { value: "none", label: "None" },
  { value: "category", label: "Category exclusive" },
  { value: "full", label: "Fully exclusive" },
] as const;

export const LICENSE_TYPES = [
  { value: "non_exclusive", label: "Non-exclusive licence" },
  { value: "exclusive", label: "Exclusive licence" },
  { value: "limited", label: "Limited licence" },
  { value: "buyout", label: "Full buyout" },
] as const;

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "BRL"] as const;

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;

export const VERIFICATION_TYPES = {
  past_work: { label: "Past work verified", how: "Confirmed with the brand or via a completed campaign" },
  // legacy manual requests (before the ID verification flow); shown in the admin queue only
  identity: { label: "Identity (legacy request)", how: "Manual identity request from before ID verification" },
} as const;

export function labelOf<T extends { value: string; label: string }>(list: readonly T[], value: string | null | undefined) {
  return list.find((x) => x.value === value)?.label ?? value ?? "";
}
