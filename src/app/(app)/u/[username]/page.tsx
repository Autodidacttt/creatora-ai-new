"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ImagePlus, Megaphone, UserX } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import { useProfile } from "@/hooks/use-profile";
import { getCreatorPosts } from "@/services/posts";
import { getBrandCampaigns } from "@/services/campaigns";
import { recordInteraction } from "@/services/social";
import { recordProfileVisit } from "@/services/dashboard";
import { ProfileHeader } from "@/components/profile/profile-header";
import { VerificationPanel } from "@/components/profile/verification-panel";
import { CreatorAttributes, ExperienceList, WorkflowOverview } from "@/components/profile/attributes";
import { PostGrid } from "@/components/posts/post-grid";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { SectionTitle } from "@/components/ui/glass";
import { buttonVariants } from "@/components/ui/button";

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>();
  const profile = useProfile(decodeURIComponent(username));
  const me = useMe();
  const db = useDb();
  const viewed = useRef<string | null>(null);

  // Profile views feed the creator dashboard (only counted for other people's profiles)
  useEffect(() => {
    const p = profile.data;
    if (p && !p.is_me && viewed.current !== p.id) {
      viewed.current = p.id;
      recordInteraction(db, "profile", p.id, "view").catch(() => undefined);
      if (p.role === "creator") recordProfileVisit(db, p.id);
    }
  }, [profile.data, db]);

  if (profile.isPending) return <ProfileSkeleton />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  if (!profile.data) {
    return (
      <EmptyState icon={<UserX />} title="Profile not found" description="This account doesn't exist or changed its username."
        action={<Link href="/discover" className={buttonVariants({ variant: "primary" })}>Discover creators</Link>} />
    );
  }
  const p = profile.data;

  return (
    <div className="space-y-5">
      <ProfileHeader profile={p} onFollowChange={() => profile.refetch()} />
      {p.role === "creator" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="order-2 min-w-0 space-y-4 lg:order-1">
            <SectionTitle eyebrow="AI portfolio" title={`${p.stats.posts} piece${p.stats.posts === 1 ? "" : "s"}`}
              action={p.is_me && <Link href="/posts/new" className={buttonVariants({ size: "sm", variant: "primary" })}><ImagePlus /> Add</Link>} />
            <Portfolio creatorId={p.id} isMe={p.is_me} />
          </div>
          <aside className="order-1 space-y-4 lg:order-2">
            <VerificationPanel profile={p} />
            <CreatorAttributes profile={p} />
            {p.creator?.workflow_overview && <WorkflowOverview text={p.creator.workflow_overview} />}
            <ExperienceList profile={p} />
          </aside>
        </div>
      ) : p.role === "brand" ? (
        <BrandSection brandId={p.id} isMe={p.is_me} description={p.brand?.description ?? null} viewerRole={me.role} />
      ) : null /* admin profiles have no briefs (only brands create them) */}
    </div>
  );
}

function Portfolio({ creatorId, isMe }: { creatorId: string; isMe: boolean }) {
  const db = useDb();
  const q = useInfiniteQuery({
    queryKey: ["creator-posts", creatorId],
    queryFn: ({ pageParam }) => getCreatorPosts(db, creatorId, pageParam, 18),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  if (q.isPending) {
    return <div className="columns-2 gap-4 md:columns-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className={`mb-4 ${i % 2 ? "aspect-[4/5]" : "aspect-video"}`} />)}</div>;
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const posts = q.data.pages.flatMap((p) => p.items);
  if (!posts.length) {
    return (
      <EmptyState
        icon={<ImagePlus />}
        title={isMe ? "Your portfolio is empty" : "No portfolio pieces yet"}
        description={isMe ? "Upload AI-generated work or link it from YouTube, Vimeo, Instagram or Behance — with the tools and workflow you used." : "Check back soon."}
        action={isMe && <Link href="/posts/new" className={buttonVariants({ variant: "primary" })}>Add your first piece</Link>}
      />
    );
  }
  return (
    <>
      <PostGrid posts={posts} />
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </>
  );
}

function BrandSection({ brandId, isMe, description, viewerRole }: { brandId: string; isMe: boolean; description: string | null; viewerRole: string }) {
  const db = useDb();
  const q = useQuery({ queryKey: ["brand-campaigns", brandId], queryFn: () => getBrandCampaigns(db, { brandId }) });
  const visible = q.data?.items.filter((c) => isMe || c.status !== "draft") ?? [];
  return (
    <div className="space-y-4">
      {description && <p className="glass rounded-[2rem] p-5 text-sm leading-relaxed text-ink-2">{description}</p>}
      <SectionTitle eyebrow="Briefs" title={isMe ? "Your campaigns" : "Open & past briefs"}
        action={isMe && <Link href="/campaigns/new" className={buttonVariants({ size: "sm", variant: "primary" })}>New brief</Link>} />
      {q.isPending && <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-64" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && visible.length === 0 && (
        <EmptyState icon={<Megaphone />} title="No briefs yet"
          description={isMe ? "Create a brief — the AI brief builder can draft it from one sentence." : "This brand hasn't published a brief yet."}
          action={isMe && <Link href="/campaigns/new" className={buttonVariants({ variant: "primary" })}>Create a brief</Link>} />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((c) => <CampaignCard key={c.id} campaign={c} showBrand={false} showStats={isMe || viewerRole === "admin"} />)}
      </div>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-80 rounded-[2rem]" />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-96 rounded-[2rem]" />
        <Skeleton className="h-96 rounded-[2rem]" />
      </div>
    </div>
  );
}
