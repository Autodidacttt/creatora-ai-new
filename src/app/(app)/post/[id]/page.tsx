"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useDb } from "@/features/session";
import { getPost } from "@/services/posts";
import { PostDetail } from "@/components/posts/post-detail";
import { GlassPanel } from "@/components/ui/glass";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const db = useDb();
  const router = useRouter();
  const post = useQuery({ queryKey: ["post", id], queryFn: () => getPost(db, id) });
  return (
    <div className="space-y-4">
      <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Back</button>
      <GlassPanel className="p-4 sm:p-6">
        {post.isPending && <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="aspect-video" /><Skeleton className="h-96" /></div>}
        {post.isError && <ErrorState error={post.error} onRetry={() => post.refetch()} />}
        {post.data === null && (
          <EmptyState title="This piece isn't available" description="It may have been deleted or removed by moderation."
            action={<Link href="/home" className={buttonVariants({ variant: "primary" })}>Back home</Link>} />
        )}
        {post.data && <PostDetail post={post.data} onDeleted={() => router.push("/home")} />}
      </GlassPanel>
    </div>
  );
}
