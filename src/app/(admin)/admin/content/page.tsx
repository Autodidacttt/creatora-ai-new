"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, Flag, RotateCcw, Search } from "lucide-react";
import { useDb } from "@/features/session";
import { useDebounced } from "@/hooks/use-debounce";
import { listPosts } from "@/services/admin";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { PostThumb } from "@/components/posts/post-media";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { timeAgo } from "@/lib/utils";

export default function AdminContent() {
  const db = useDb();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"live" | "removed">("live");
  const q = useDebounced(query, 300);
  const posts = useQuery({ queryKey: ["admin", "posts", q, view], queryFn: () => listPosts(db, { query: q, removed: view === "removed" }) });
  const { busy, run } = useAdminAction();

  return (
    <div className="space-y-5">
      <h1 className="display text-3xl">Content</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-full bg-card px-4 shadow-sm">
          <Search className="size-4 text-ink-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title" aria-label="Search posts" className="w-full bg-transparent text-sm focus:outline-none" />
        </label>
        <SegmentedTabs size="sm" value={view} onChange={setView} items={[{ value: "live", label: "Live" }, { value: "removed", label: "Removed" }]} />
      </div>
      {posts.isPending && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>}
      {posts.isError && <ErrorState error={posts.error} onRetry={() => posts.refetch()} />}
      {posts.data?.items.length === 0 && <EmptyState title={view === "removed" ? "No removed content" : "No posts found"} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {posts.data?.items.map(({ post, reports }) => (
          <article key={post.id} className="glass overflow-hidden rounded-[1.75rem] p-3">
            <Link href={`/post/${post.id}`}><PostThumb post={post} className="!aspect-video" /></Link>
            <div className="space-y-2 p-2">
              <p className="line-clamp-1 font-semibold">{post.title}</p>
              <p className="text-xs text-ink-3">by @{post.creator.username} · {timeAgo(post.created_at)}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {reports > 0 && <Chip tone="danger" icon={<Flag />}>{reports} report{reports > 1 ? "s" : ""}</Chip>}
                {post.commercial_use_cleared && <Chip tone="success">Commercial OK</Chip>}
              </div>
              <Button size="sm" variant={post.is_removed ? "secondary" : "danger"} loading={busy === post.id}
                onClick={() => run(post.id, { action: "set_post_removed", post_id: post.id, value: !post.is_removed }, post.is_removed ? "Post restored" : "Post removed")}>
                {post.is_removed ? <RotateCcw /> : <EyeOff />} {post.is_removed ? "Restore" : "Remove"}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
