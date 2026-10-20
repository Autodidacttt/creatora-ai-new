"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useDb, useMe } from "@/features/session";
import { recordPostView } from "@/services/dashboard";
import { ArrowRight, MessageCircle, Sparkles, TrendingUp, UserCheck, Compass } from "lucide-react";
import type { FeedItem } from "@/services/posts";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { LikeButton, SaveButton } from "@/components/posts/actions";
import { PostThumb } from "@/components/posts/post-media";
import { compact, timeAgo } from "@/lib/utils";

const REASONS = {
  following: { label: "From someone you follow", icon: UserCheck },
  for_you: { label: "Picked for you", icon: Sparkles },
  fresh: { label: "Fresh this week", icon: TrendingUp },
  explore: { label: "Explore", icon: Compass },
};

export function FeedCard({ item, index }: { item: FeedItem; index: number }) {
  const { post, reason } = item;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const R = REASONS[reason];
  const db = useDb();
  const me = useMe();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || post.creator.id === me.id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      clearTimeout(timer);
      if (e.isIntersecting) timer = setTimeout(() => { recordPostView(db, post.id); io.disconnect(); }, 1500);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { clearTimeout(timer); io.disconnect(); };
  }, [db, post.id, post.creator.id, me.id]);
  const open = () => {
    const p = new URLSearchParams(params);
    p.set("post", post.id);
    router.push(`${pathname}?${p}`, { scroll: false });
  };

  return (
    <motion.article
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 200, damping: 26, delay: (index % 4) * 0.04 }}
      className="glass overflow-hidden rounded-[2rem]"
    >
      <div className="flex items-center gap-3 p-4">
        <Link href={`/u/${post.creator.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar src={post.creator.avatar_url} name={post.creator.display_name} verified={post.creator.is_verified} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{post.creator.display_name}</span>
            <span className="block truncate text-xs text-ink-3">{post.creator.headline ?? `@${post.creator.username}`}</span>
          </span>
        </Link>
        <Chip tone={reason === "following" ? "amber" : "outline"} icon={<R.icon />} className="hidden sm:inline-flex">{R.label}</Chip>
      </div>
      <button type="button" onClick={open} className="group block w-full px-3" aria-label={`Open ${post.title}`}>
        <PostThumb post={post} className="max-h-[70vh] w-full" rounded="rounded-[1.5rem]" />
      </button>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={open} className="min-w-0 text-left">
            <h3 className="display text-lg leading-snug">{post.title}</h3>
            {post.description && <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{post.description}</p>}
          </button>
          <span className="shrink-0 text-xs text-ink-3">{timeAgo(post.created_at)}</span>
        </div>
        {post.workflow_steps.length > 0 ? (
          <p className="flex flex-wrap items-center gap-1 text-xs text-ink-2">
            {post.workflow_steps.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="rounded-full bg-card px-2 py-0.5 font-medium text-ink shadow-sm">{s.tool ?? "Manual"}</span>
                {i < post.workflow_steps.length - 1 && <ArrowRight className="size-3 text-ink-3" />}
              </span>
            ))}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">{post.tools.map((t) => <Chip key={t.id} tone="glass">{t.name}</Chip>)}</div>
        )}
        <div className="flex items-center gap-2">
          <LikeButton postId={post.id} liked={post.liked} count={post.likes_count} />
          <button onClick={open} className="inline-flex items-center gap-1.5 rounded-full bg-card px-3.5 py-2 text-sm font-medium shadow-sm hover:shadow-md">
            <MessageCircle className="size-4" /> {compact(post.comments_count)}
          </button>
          <span className="flex-1" />
          {post.aspect_ratio && <Chip tone="outline">{post.aspect_ratio}</Chip>}
          <SaveButton postId={post.id} saved={post.saved} />
        </div>
      </div>
    </motion.article>
  );
}
