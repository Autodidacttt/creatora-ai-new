"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Heart, MessageCircle } from "lucide-react";
import type { PostCard } from "@/types/app";
import { useDb } from "@/features/session";
import { getPost } from "@/services/posts";
import { Dialog } from "@/components/ui/overlay";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { compact } from "@/lib/utils";
import { PostThumb } from "./post-media";
import { PostDetail } from "./post-detail";

/** Masonry portfolio grid. Clicking opens the post in a modal (URL-synced via ?post=id). */
export function PostGrid({ posts }: { posts: PostCard[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const open = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("post", id);
    router.push(`${pathname}?${p}`, { scroll: false });
  };

  return (
    <>
      <div className="columns-2 gap-3 sm:gap-4 md:columns-3">
        {posts.map((post, i) => (
          <motion.button
            key={post.id}
            type="button"
            onClick={() => open(post.id)}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.4) }}
            className="group relative mb-3 block w-full break-inside-avoid text-left sm:mb-4"
            aria-label={`Open ${post.title}`}
          >
            <PostThumb post={post} />
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-end rounded-[1.5rem] bg-gradient-to-t from-black/70 via-black/10 to-transparent p-3 text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
              <p className="line-clamp-1 text-sm font-semibold">{post.title}</p>
              <p className="line-clamp-1 text-xs text-white/80">{post.tools.map((t) => t.name).join(" · ")}</p>
              <p className="mt-1 flex gap-3 text-xs">
                <span className="flex items-center gap-1"><Heart className="size-3" /> {compact(post.likes_count)}</span>
                <span className="flex items-center gap-1"><MessageCircle className="size-3" /> {compact(post.comments_count)}</span>
              </p>
            </div>
          </motion.button>
        ))}
      </div>
      <PostModal />
    </>
  );
}

/** Reads ?post=id and shows the post detail in a dialog. */
export function PostModal() {
  const db = useDb();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = params.get("post");
  const post = useQuery({ queryKey: ["post", id], queryFn: () => getPost(db, id!), enabled: !!id });
  const close = () => {
    const p = new URLSearchParams(params);
    p.delete("post");
    router.push(p.size ? `${pathname}?${p}` : pathname, { scroll: false });
  };
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && close()} title={post.data?.title ?? "Portfolio piece"} size="xl" hideTitle>
      {post.isPending && <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="aspect-video" /><Skeleton className="h-80" /></div>}
      {post.isError && <ErrorState error={post.error} onRetry={() => post.refetch()} />}
      {post.data === null && <ErrorState error="This piece was removed or doesn't exist." title="Not available" />}
      {post.data && <PostDetail post={post.data} onDeleted={close} />}
    </Dialog>
  );
}
