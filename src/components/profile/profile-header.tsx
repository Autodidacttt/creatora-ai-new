/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useState } from "react";
import { BarChart3, Globe, MapPin, Pencil, Plus, Sparkles } from "lucide-react";
import type { FullProfile } from "@/types/app";
import { AVAILABILITY, EXPERIENCE_LEVELS, labelOf } from "@/config/constants";
import { Avatar } from "@/components/ui/avatar";
import { Chip, VerifiedChip } from "@/components/ui/chip";
import { Counter } from "@/components/ui/counter";
import { buttonVariants } from "@/components/ui/button";
import { ContactButton, FollowButton } from "@/components/posts/actions";
import { cn } from "@/lib/utils";
import { FollowListDialog } from "./follow-list";

export function ProfileHeader({ profile, onFollowChange }: { profile: FullProfile; onFollowChange: () => void }) {
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const avail = AVAILABILITY.find((a) => a.value === profile.creator?.availability);
  const stats = [
    { key: "followers", label: "Followers", value: profile.stats.followers, onClick: () => setList("followers") },
    { key: "following", label: "Following", value: profile.stats.following, onClick: () => setList("following") },
    ...(profile.role === "creator"
      ? [
          { key: "posts", label: "Pieces", value: profile.stats.posts },
          { key: "likes", label: "Likes", value: profile.stats.likes },
        ]
      : []),
  ];

  return (
    <section className="glass overflow-hidden rounded-[2rem]">
      <div className="relative h-36 sm:h-48">
        {profile.cover_url ? (
          <img src={profile.cover_url} alt="" className="size-full object-cover" />
        ) : (
          <div className="size-full bg-gradient-to-br from-amber/60 via-amber-soft to-bg-2" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
      </div>
      <div className="px-5 pb-6 sm:px-8">
        <div className="-mt-12 flex flex-wrap items-end justify-between gap-4 sm:-mt-16">
          <Avatar src={profile.avatar_url} name={profile.display_name} size="2xl" className="[&>img]:ring-4 [&>span:first-child]:ring-4" verified={profile.is_verified} />
          <div className="flex flex-wrap gap-2">
            {profile.is_me ? (
              <>
                <Link href="/settings/profile" className={buttonVariants({ variant: "secondary" })}><Pencil /> Edit profile</Link>
                {profile.role === "creator" && (
                  <>
                    <Link href="/dashboard" className={buttonVariants({ variant: "dark" })}><BarChart3 /> Dashboard</Link>
                    <Link href="/posts/new" className={buttonVariants({ variant: "primary" })}><Plus /> Add piece</Link>
                  </>
                )}
              </>
            ) : (
              <>
                <FollowButton profileId={profile.id} following={profile.is_following} onChange={onFollowChange} />
                <ContactButton profileId={profile.id} label={profile.role === "creator" ? "Contact" : "Message"} />
              </>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <h1 className="display flex flex-wrap items-center gap-2 text-3xl sm:text-4xl">
              {profile.display_name}
              {profile.is_verified && <VerifiedChip label={profile.role === "brand" ? "Verified brand" : "Verified"} />}
            </h1>
            <p className="text-sm text-ink-3">
              @{profile.username}
              {profile.follows_you && <span className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-xs">Follows you</span>}
            </p>
          </div>
          {profile.headline && <p className="text-base font-medium">{profile.headline}</p>}
          {profile.bio && <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-ink-2">{profile.bio}</p>}

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {profile.role === "creator" && avail && (
              <Chip tone="glass"><span className={cn("size-2 rounded-full", avail.dot)} /> {avail.label}</Chip>
            )}
            {profile.creator && <Chip tone="glass" icon={<Sparkles />}>{labelOf(EXPERIENCE_LEVELS, profile.creator.experience_level)}</Chip>}
            {profile.brand?.industry && <Chip tone="glass">{profile.brand.industry}</Chip>}
            {profile.location && <Chip tone="outline" icon={<MapPin />}>{profile.location}</Chip>}
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:text-ink">
                <Globe className="size-3.5" /> {profile.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            )}
            {Object.entries(profile.links ?? {}).map(([k, url]) => (
              <a key={k} href={url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-2.5 py-1 text-xs capitalize text-ink-2 hover:text-ink">
                {k}
              </a>
            ))}
          </div>

          <dl className="flex flex-wrap gap-2 pt-1">
            {stats.map((s) => {
              const inner = (
                <>
                  <dd className="display text-xl tabular-nums"><Counter value={s.value} /></dd>
                  <dt className="text-xs text-ink-3">{s.label}</dt>
                </>
              );
              return "onClick" in s && s.onClick ? (
                <button key={s.key} onClick={s.onClick} className="min-w-20 rounded-2xl bg-card px-4 py-2 text-left shadow-sm transition-transform hover:-translate-y-0.5">{inner}</button>
              ) : (
                <div key={s.key} className="min-w-20 rounded-2xl bg-card px-4 py-2 shadow-sm">{inner}</div>
              );
            })}
          </dl>
        </div>
      </div>
      <FollowListDialog userId={profile.id} kind={list} onClose={() => setList(null)} />
      {profile.is_me && profile.role === "creator" && !profile.tools.length && (
        <div className="border-t border-line bg-amber-soft/60 px-5 py-3 text-sm sm:px-8">
          Add your AI tools and skills so brands can find you. <Link href="/settings/profile" className="font-semibold underline">Complete profile</Link>
        </div>
      )}
    </section>
  );
}
