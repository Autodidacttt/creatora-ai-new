"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, Sparkles, Users } from "lucide-react";
import type { CampaignCard as Campaign } from "@/types/app";
import { LICENSE_TYPES, labelOf } from "@/config/constants";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { cn, daysUntil, money } from "@/lib/utils";
import { TrustBadges } from "@/components/verification/trust-badges";

export function StatusChip({ status }: { status: Campaign["status"] }) {
  const tone = status === "active" ? "success" : status === "draft" ? "outline" : "dark";
  return <Chip tone={tone} className="capitalize">{status}</Chip>;
}

export function DeadlineChip({ deadline }: { deadline: string | null }) {
  const d = daysUntil(deadline);
  if (d === null) return null;
  const label = d < 0 ? "Closed" : d === 0 ? "Due today" : `${d} day${d === 1 ? "" : "s"} left`;
  return <Chip tone={d >= 0 && d <= 7 ? "amber" : "outline"} icon={<CalendarClock />}>{label}</Chip>;
}

/** Brief summary card. `score`/`reasons` show the creator-facing relevance when present. */
export function CampaignCard({ campaign, score, reasons, footer, showBrand = true, showStats }: {
  campaign: Campaign;
  score?: number;
  reasons?: string[];
  footer?: ReactNode;
  showBrand?: boolean;
  showStats?: boolean;
}) {
  return (
    <article className="glass glow-hover group relative flex flex-col gap-4 rounded-[2rem] p-5 transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-start justify-between gap-3">
        {showBrand ? (
          <Link href={`/u/${campaign.brand.username}`} className="relative z-10 flex min-w-0 items-center gap-2.5">
            <Avatar src={campaign.brand.avatar_url} name={campaign.brand.display_name} size="sm" verified={campaign.brand.is_verified} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{campaign.brand.display_name}</span>
              {campaign.brand.industry && <span className="block truncate text-xs text-ink-3">{campaign.brand.industry}</span>}
              <TrustBadges badges={campaign.brand.badges} role="brand" className="mt-0.5" />
            </span>
          </Link>
        ) : (
          <StatusChip status={campaign.status} />
        )}
        {score !== undefined ? (
          <div className="shrink-0 text-right" title="How well this brief matches your profile">
            <span className="display text-2xl tabular-nums">{score}</span>
            <span className="block text-[10px] uppercase tracking-wider text-ink-3">match</span>
          </div>
        ) : showBrand ? (
          <StatusChip status={campaign.status} />
        ) : null}
      </div>

      <Link href={`/campaigns/${campaign.id}`} className="block after:absolute after:inset-0 after:rounded-[2rem]" aria-label={campaign.title}>
        <h3 className="display text-lg leading-snug">{campaign.title}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">{campaign.description}</p>
      </Link>

      <div className="flex flex-wrap gap-1.5">
        {campaign.content_type && <Chip tone="solid">{campaign.content_type.name}</Chip>}
        {campaign.aspect_ratios.map((a) => <Chip key={a} tone="glass">{a === "custom" ? campaign.custom_aspect ?? "Custom" : a}</Chip>)}
        {campaign.platforms.slice(0, 3).map((p) => <Chip key={p.id} tone="outline">{p.name}</Chip>)}
        {campaign.ai_assisted && <Chip tone="amber" icon={<Sparkles />}>AI-structured</Chip>}
      </div>

      {reasons && reasons.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-amber-soft/60 px-3.5 py-2.5 text-xs">
          {reasons.slice(0, 3).map((r) => <li key={r} className="flex gap-1.5"><span aria-hidden>✦</span>{r}</li>)}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span className="font-semibold text-ink">{money(campaign.budget_min, campaign.budget_max, campaign.currency)}</span>
        <span aria-hidden>·</span>
        <span>{labelOf(LICENSE_TYPES, campaign.license_type)}</span>
        <span aria-hidden>·</span>
        <span className="flex items-center gap-1"><Users className="size-3.5" /> {campaign.creators_needed} needed</span>
        <span className="ml-auto"><DeadlineChip deadline={campaign.deadline} /></span>
      </div>

      {showStats && campaign.stats && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Applications", campaign.stats.applications],
            ["Shortlisted", campaign.stats.shortlisted],
            ["Hired", campaign.stats.selected],
          ].map(([k, v]) => (
            <div key={k} className={cn("rounded-2xl bg-card px-3 py-2 text-center")}>
              <p className="display text-lg tabular-nums">{v}</p>
              <p className="text-[10px] text-ink-3">{k}</p>
            </div>
          ))}
        </div>
      )}
      {footer && <div className="relative z-10">{footer}</div>}
    </article>
  );
}
