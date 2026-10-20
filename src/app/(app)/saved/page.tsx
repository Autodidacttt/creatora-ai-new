"use client";

import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { useDb } from "@/features/session";
import { getSavedPosts } from "@/services/posts";
import { PostGrid } from "@/components/posts/post-grid";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";

export default function SavedPage() {
  const db = useDb();
  const q = useInfiniteQuery({
    queryKey: ["saved"],
    queryFn: ({ pageParam }) => getSavedPosts(db, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const posts = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Collection</p>
        <h1 className="display text-3xl">Saved work</h1>
        <p className="mt-1 text-sm text-ink-2">Only you can see what you save.</p>
      </div>
      {q.isPending && <div className="columns-2 gap-4 md:columns-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="mb-4 aspect-[4/5]" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && posts.length === 0 && (
        <EmptyState icon={<Bookmark />} title="Nothing saved yet" description="Tap Save on any portfolio piece to build a moodboard of references and creators."
          action={<Link href="/home" className={buttonVariants({ variant: "primary" })}>Browse the feed</Link>} />
      )}
      {posts.length > 0 && <PostGrid posts={posts} />}
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </div>
  );
}
