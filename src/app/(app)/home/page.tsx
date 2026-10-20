"use client";

import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Compass, Sparkles } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import { getFeed } from "@/services/posts";
import { getBrandCampaigns, getDashboard, getOpportunities } from "@/services/campaigns";
import { getSwipeDeck } from "@/services/discovery";
import { useProfile } from "@/hooks/use-profile";
import { FeedCard } from "@/components/feed/feed-card";
import { PostModal } from "@/components/posts/post-grid";
import { StatBlob } from "@/components/ui/stat-blob";
import { PillCTA } from "@/components/ui/pill-cta";
import { Avatar } from "@/components/ui/avatar";
import { SectionTitle } from "@/components/ui/glass";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { FollowButton } from "@/components/posts/actions";
import { buttonVariants } from "@/components/ui/button";
import { DeadlineChip } from "@/components/campaign/campaign-card";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Hero() {
  const me = useMe();
  const db = useDb();
  const profile = useProfile(me.username);
  const role = me.role === "brand" ? "brand" : "creator";
  const dash = useQuery({ queryKey: ["dashboard", role], queryFn: () => getDashboard(db, role), enabled: me.role !== "admin" });
  const s = profile.data?.stats;
  const d = dash.data ?? {};

  return (
    <section className="glass relative overflow-hidden rounded-[2.25rem] p-6 sm:p-8">
      <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-end">
        <div>
          <p className="eyebrow">{greeting()}, {me.display_name.split(" ")[0]}</p>
          <h1 className="display mt-2 text-4xl leading-[0.95] sm:text-5xl">
            {me.role === "brand" ? (<>Find the creators<br />your brief <span className="text-amber-2">deserves</span></>)
              : (<>Make it. Show the<br /><span className="text-amber-2">workflow.</span> Get hired.</>)}
          </h1>
          <div className="mt-6 flex flex-wrap gap-3">
            {me.role === "brand" ? (
              <>
                <PillCTA href="/campaigns/new">Create a brief</PillCTA>
                <Link href="/discover" className={buttonVariants({ variant: "glass", size: "lg" })}><Compass /> Discover</Link>
              </>
            ) : (
              <>
                <PillCTA href="/opportunities">Explore briefs</PillCTA>
                <Link href="/posts/new" className={buttonVariants({ variant: "glass", size: "lg" })}><Sparkles /> Add work</Link>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {me.role === "brand" ? (
            <>
              <StatBlob value={d.active ?? 0} label="Active briefs" href="/campaigns?status=active" accent />
              <StatBlob value={d.applications ?? 0} label="Applications" href="/campaigns" />
              <StatBlob value={d.shortlisted ?? 0} label="Shortlisted creators" href="/campaigns" />
              <StatBlob value={s?.following ?? 0} label="Creators followed" />
            </>
          ) : (
            <>
              <StatBlob value={s?.followers ?? 0} label="Followers" accent href={`/u/${me.username}`} />
              <StatBlob value={s?.likes ?? 0} label="Likes on your work" href={`/u/${me.username}`} />
              <StatBlob value={d.profile_views ?? 0} label="Profile views" />
              <StatBlob value={d.applications ?? 0} label="Briefs applied" href="/opportunities?tab=applied" />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Sidebar() {
  const me = useMe();
  const db = useDb();
  const suggestions = useQuery({ queryKey: ["home-suggestions"], queryFn: () => getSwipeDeck(db, null, 4) });
  const opps = useQuery({ queryKey: ["opportunities", "home"], queryFn: () => getOpportunities(db, "for_you", 0, 3), enabled: me.role === "creator" });
  const briefs = useQuery({ queryKey: ["campaigns", "active"], queryFn: () => getBrandCampaigns(db, { status: "active" }), enabled: me.role === "brand" });

  return (
    <aside className="space-y-5">
      <section className="glass rounded-[2rem] p-5">
        <SectionTitle title="Creators to know" className="mb-3" />
        {suggestions.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="mb-2 h-12" />)}
        {suggestions.data?.length === 0 && <p className="text-sm text-ink-2">You&apos;ve seen everyone — check back as new creators join.</p>}
        <ul className="space-y-2">
          {suggestions.data?.map(({ creator, reasons }) => (
            <li key={creator.id} className="flex items-center gap-3">
              <Link href={`/u/${creator.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar src={creator.avatar_url} name={creator.display_name} verified={creator.is_verified} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{creator.display_name}</span>
                  <span className="block truncate text-xs text-ink-3">{reasons[0] ?? creator.headline}</span>
                </span>
              </Link>
              <FollowButton profileId={creator.id} following={creator.is_following} size="sm" />
            </li>
          ))}
        </ul>
      </section>

      {me.role === "creator" && (
        <section className="glass rounded-[2rem] p-5">
          <SectionTitle title="Briefs for you" action={<Link href="/opportunities" className="text-xs font-semibold underline-offset-4 hover:underline">All</Link>} className="mb-3" />
          {opps.isPending && <Skeleton className="h-24" />}
          {opps.data?.items.length === 0 && <p className="text-sm text-ink-2">No open briefs match yet.</p>}
          <ul className="space-y-2">
            {opps.data?.items.map((o) => (
              <li key={o.campaign.id}>
                <Link href={`/campaigns/${o.campaign.id}`} className="block rounded-2xl bg-card p-3 transition-transform hover:-translate-y-0.5">
                  <span className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-semibold">{o.campaign.title}</span>
                    <span className="display shrink-0 text-lg">{o.score}</span>
                  </span>
                  <span className="mt-1 block text-xs text-ink-3">{o.campaign.brand.display_name} · {o.reasons[0] ?? o.campaign.content_type?.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {me.role === "brand" && (
        <section className="glass rounded-[2rem] p-5">
          <SectionTitle title="Active briefs" action={<Link href="/campaigns" className="text-xs font-semibold underline-offset-4 hover:underline">All</Link>} className="mb-3" />
          {briefs.isPending && <Skeleton className="h-24" />}
          {briefs.data?.items.length === 0 && (
            <p className="text-sm text-ink-2">No active briefs. <Link href="/campaigns/new" className="font-semibold underline">Create one</Link></p>
          )}
          <ul className="space-y-2">
            {briefs.data?.items.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Link href={`/campaigns/${c.id}`} className="block rounded-2xl bg-card p-3 transition-transform hover:-translate-y-0.5">
                  <span className="line-clamp-1 text-sm font-semibold">{c.title}</span>
                  <span className="mt-1 flex items-center justify-between text-xs text-ink-3">
                    {c.stats?.applications ?? 0} applications
                    <DeadlineChip deadline={c.deadline} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

export default function HomePage() {
  const db = useDb();
  const feed = useInfiniteQuery({
    queryKey: ["feed"],
    queryFn: ({ pageParam }) => getFeed(db, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <Hero />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 space-y-5" aria-label="For you">
          <SectionTitle eyebrow="For you" title="Fresh AI work" />
          {feed.isPending && [0, 1].map((i) => <Skeleton key={i} className="h-[32rem] rounded-[2rem]" />)}
          {feed.isError && <ErrorState error={feed.error} onRetry={() => feed.refetch()} />}
          {feed.isSuccess && items.length === 0 && (
            <EmptyState icon={<Sparkles />} title="Nothing in your feed yet" description="Follow creators or explore to fill your feed."
              action={<Link href="/discover" className={buttonVariants({ variant: "primary" })}>Discover creators</Link>} />
          )}
          {items.map((item, i) => <FeedCard key={item.post.id} item={item} index={i} />)}
          {feed.hasNextPage && <InfiniteSentinel onVisible={() => !feed.isFetchingNextPage && feed.fetchNextPage()} loading={feed.isFetchingNextPage} />}
          {feed.isSuccess && !feed.hasNextPage && items.length > 0 && (
            <p className="py-6 text-center text-sm text-ink-3">You&apos;re all caught up ✦</p>
          )}
        </section>
        <Sidebar />
      </div>
      <PostModal />
    </div>
  );
}
