/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeCheck, MapPin } from "lucide-react";
import { TrustBadges } from "@/components/verification/trust-badges";
import type { CreatorCard as Creator } from "@/types/app";
import { AVAILABILITY, EXPERIENCE_LEVELS, labelOf } from "@/config/constants";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { ContactButton, FollowButton } from "@/components/posts/actions";
import { cn, compact } from "@/lib/utils";

/** Search / ranking result card: preview strip, tools (matched ones highlighted), quick actions. */
export function CreatorResultCard({ creator, highlightTools = [], score, scoreLabel = "relevance", scoreTitle = "Relevance to this brief — not a measure of talent", reasons, footer, compactActions }: {
  creator: Creator;
  highlightTools?: number[];
  score?: number;
  scoreLabel?: string;
  scoreTitle?: string;
  reasons?: string[];
  footer?: ReactNode;
  compactActions?: boolean;
}) {
  const avail = AVAILABILITY.find((a) => a.value === creator.availability);
  const tools = [...creator.tools].sort((a, b) => Number(highlightTools.includes(b.id)) - Number(highlightTools.includes(a.id)));

  return (
    <article className="glass glow-hover group relative flex flex-col overflow-hidden rounded-[2rem] transition-all duration-300 hover:-translate-y-1">
      <div className="grid h-32 grid-cols-3 gap-0.5 overflow-hidden">
        {[0, 1, 2].map((i) => {
          const p = creator.preview[i];
          return p?.url ? (
            <img key={i} src={p.url} alt={p.title} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div key={i} className="bg-gradient-to-br from-amber-soft to-bg-2" />
          );
        })}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="-mt-10 flex items-end justify-between">
          <Avatar src={creator.avatar_url} name={creator.display_name} size="lg" verified={creator.is_verified} className="[&>img]:ring-4 [&>span:first-child]:ring-4" />
          {score !== undefined && (
            <div className="rounded-2xl bg-card px-3 py-1.5 text-right shadow-sm" title={scoreTitle}>
              <span className="display text-xl tabular-nums">{score}</span>
              <span className="block text-[9px] uppercase tracking-wider text-ink-3">{scoreLabel}</span>
            </div>
          )}
        </div>
        <Link href={`/u/${creator.username}`} className="after:absolute after:inset-0" aria-label={`View ${creator.display_name}`}>
          <h3 className="display flex items-center gap-1.5 text-lg">
            {creator.display_name}
            {creator.is_verified && <BadgeCheck className="size-4 fill-amber text-on-amber" aria-label="Verified" />}
          </h3>
          {creator.headline && <p className="line-clamp-1 text-sm text-ink-2">{creator.headline}</p>}
        </Link>
        <TrustBadges badges={creator.badges} className="relative z-10" />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {avail && <Chip tone="outline"><span className={cn("size-1.5 rounded-full", avail.dot)} />{avail.label}</Chip>}
          {creator.experience_level && <Chip tone="outline">{labelOf(EXPERIENCE_LEVELS, creator.experience_level)}</Chip>}
          {creator.location && <Chip tone="outline" icon={<MapPin />}>{creator.location.split(",")[0]}</Chip>}
        </div>
        <div className="flex flex-wrap gap-1">
          {tools.slice(0, 5).map((t) => (
            <Chip key={t.id} tone={highlightTools.includes(t.id) ? "solid" : "neutral"}>{t.name}</Chip>
          ))}
          {tools.length > 5 && <Chip tone="outline">+{tools.length - 5}</Chip>}
        </div>
        {reasons && reasons.length > 0 && (
          <div className="rounded-2xl bg-amber-soft/70 px-3 py-2">
            <p className="eyebrow mb-1 !text-ink">Why this creator?</p>
            <ul className="space-y-0.5 text-xs">
              {reasons.slice(0, 4).map((r) => <li key={r}>✦ {r}</li>)}
            </ul>
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 pt-1">
          <span className="mr-auto text-xs text-ink-3">{compact(creator.followers_count)} followers · {creator.posts_count} pieces</span>
          {!compactActions && (
            <div className="relative z-10 flex gap-1.5">
              <FollowButton profileId={creator.id} following={creator.is_following} size="sm" />
              <ContactButton profileId={creator.id} size="sm" label="Contact" />
            </div>
          )}
        </div>
        {footer && <div className="relative z-10">{footer}</div>}
      </div>
    </article>
  );
}
