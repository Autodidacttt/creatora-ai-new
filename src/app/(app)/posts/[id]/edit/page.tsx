"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useDb, useMe } from "@/features/session";
import { getPost } from "@/services/posts";
import { PostForm } from "@/components/posts/post-form";
import { ErrorState, Skeleton } from "@/components/ui/states";

export default function EditPostPage() {
  const { id } = useParams<{ id: string }>();
  const db = useDb();
  const me = useMe();
  const post = useQuery({ queryKey: ["post", id], queryFn: () => getPost(db, id) });
  if (post.isPending) return <Skeleton className="h-[40rem] rounded-[2rem]" />;
  if (post.isError) return <ErrorState error={post.error} onRetry={() => post.refetch()} />;
  if (!post.data || post.data.creator.id !== me.id) return <ErrorState error="You can only edit your own portfolio pieces." title="Not allowed" />;
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl">Edit “{post.data.title}”</h1>
      <PostForm post={post.data} />
    </div>
  );
}
