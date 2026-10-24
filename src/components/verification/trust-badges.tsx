import { Building2, CircleCheck, UserRound } from "lucide-react";
import type { Badges } from "@/config/verification";
import { Tooltip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

export const BADGE_TEXT = {
  phone: { label: "Phone Verified", how: "Confirmed a one-time code sent to this phone number. One number can only be verified on one Creatora account." },
  identity: { label: "Identity Verified", how: "A government ID was reviewed and approved by the Creatora trust team (the automated ID check is only advisory)." },
  company: { label: "Verified Company", how: "An official company contact confirmed that this person may represent the company, or the trust team verified it." },
  individual: { label: "Individual Recruiter", how: "Hires as an individual, not on behalf of a registered company." },
  companyType: { label: "Company / Organization", how: "Account represents a company or organization." },
} as const;

function Badge({ tone, icon, label, how, size }: { tone: "ok" | "type"; icon: React.ReactNode; label: string; how: string; size: "sm" | "md" }) {
  return (
    <Tooltip side="top" content={<span className="block max-w-60 text-xs">{label}: {how}</span>}>
      <span tabIndex={0} aria-label={`${label}. ${how}`}
        className={cn("inline-flex items-center gap-1 rounded-full font-medium [&_svg]:shrink-0",
          size === "sm" ? "px-2 py-0.5 text-[10px] [&_svg]:size-3" : "px-2.5 py-1 text-xs [&_svg]:size-3.5",
          tone === "ok" ? "bg-success/10 text-success" : "bg-ink/[0.06] text-ink-2")}>
        {icon}{label}
      </span>
    </Tooltip>
  );
}

/** "👤 Individual Recruiter · 🟢 Phone Verified · 🟢 Identity Verified" — what was verified, with tooltips. */
export function TrustBadges({ badges, role, size = "sm", showType = true, className }: {
  badges?: Partial<Badges> | null; role?: string | null; size?: "sm" | "md"; showType?: boolean; className?: string;
}) {
  if (!badges) return null;
  const items: React.ReactNode[] = [];
  if (showType && role === "brand" && badges.brand_type) {
    items.push(badges.brand_type === "individual"
      ? <Badge key="t" tone="type" size={size} icon={<UserRound />} label={BADGE_TEXT.individual.label} how={BADGE_TEXT.individual.how} />
      : <Badge key="t" tone="type" size={size} icon={<Building2 />} label={BADGE_TEXT.companyType.label} how={BADGE_TEXT.companyType.how} />);
  }
  if (badges.company_verified) items.push(<Badge key="c" tone="ok" size={size} icon={<CircleCheck />} label={BADGE_TEXT.company.label} how={BADGE_TEXT.company.how} />);
  if (badges.phone_verified) items.push(<Badge key="p" tone="ok" size={size} icon={<CircleCheck />} label={BADGE_TEXT.phone.label} how={BADGE_TEXT.phone.how} />);
  if (badges.identity_verified) items.push(<Badge key="i" tone="ok" size={size} icon={<CircleCheck />} label={BADGE_TEXT.identity.label} how={BADGE_TEXT.identity.how} />);
  if (!items.length) return null;
  return <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>{items}</span>;
}
