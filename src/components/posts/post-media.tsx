/* eslint-disable @next/next/no-img-element */
"use client";

import { ExternalLink, Play } from "lucide-react";
import type { PostCard } from "@/types/app";
import { detectEmbed } from "@/services/posts";
import { aspectClass, cn } from "@/lib/utils";

/** Thumbnail used in grids and feeds (never autoplays heavy embeds). */
export function PostThumb({ post, className, rounded = "rounded-[1.5rem]" }: { post: Pick<PostCard, "media_type" | "media_url" | "thumbnail_url" | "title" | "aspect_ratio" | "embed_provider">; className?: string; rounded?: string }) {
  const src = post.thumbnail_url ?? (post.media_type === "image" ? post.media_url : null);
  return (
    <div className={cn("relative overflow-hidden bg-ink/[0.06]", rounded, aspectClass(post.aspect_ratio), className)}>
      {src ? (
        <img src={src} alt={post.title} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
      ) : post.media_type === "video" && post.media_url ? (
        <video src={`${post.media_url}#t=0.5`} muted playsInline preload="metadata" className="size-full object-cover" aria-label={post.title} />
      ) : (
        <div className="grid size-full place-items-center bg-gradient-to-br from-amber-soft to-bg-2 p-4 text-center">
          <span className="text-sm font-medium text-ink-2">{post.embed_provider ? `View on ${post.embed_provider}` : post.title}</span>
        </div>
      )}
      {post.media_type !== "image" && (
        <span className="absolute left-3 top-3 grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur" aria-hidden>
          <Play className="size-3.5 fill-white" />
        </span>
      )}
    </div>
  );
}

/** Full media player for the post detail view. */
export function PostPlayer({ post }: { post: PostCard }) {
  if (post.media_type === "video" && post.media_url) {
    return (
      <video
        src={post.media_url}
        poster={post.thumbnail_url ?? undefined}
        controls
        playsInline
        loop
        className={cn("w-full rounded-[1.5rem] bg-black object-contain", aspectClass(post.aspect_ratio), "max-h-[78vh]")}
      />
    );
  }
  if (post.media_type === "embed" && post.source_link) {
    const embed = detectEmbed(post.source_link);
    if (embed.embedUrl) {
      return (
        <div className={cn("overflow-hidden rounded-[1.5rem] bg-black", post.embed_provider === "instagram" || post.embed_provider === "tiktok" ? "aspect-[9/16] max-h-[78vh]" : aspectClass(post.aspect_ratio))}>
          <iframe
            src={embed.embedUrl}
            title={post.title}
            className="size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      );
    }
    return (
      <a href={post.source_link} target="_blank" rel="noopener noreferrer" className="group block">
        <PostThumb post={post} />
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 group-hover:underline">
          Open on {post.embed_provider ?? "source"} <ExternalLink className="size-3.5" />
        </span>
      </a>
    );
  }
  const src = post.media_url ?? post.thumbnail_url;
  return src ? (
    <img src={src} alt={post.title} className="max-h-[78vh] w-full rounded-[1.5rem] object-contain" />
  ) : (
    <PostThumb post={post} />
  );
}
