/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { BadgeCheck, Bookmark, ChevronDown, ExternalLink, Heart, ImageOff, MessageCircle, Send, Sparkles, Star, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { PostCard } from "@/types/app";
import { useDb } from "@/features/session";
import type { DeckCard } from "@/services/discovery";
import { getCreatorPosts } from "@/services/posts";
import { recordInteraction, setFollow, setLike, setSave, type InteractionAction } from "@/services/social";
import { setShortlisted } from "@/services/campaigns";
import { openConversation } from "@/services/messaging";
import { recordPostView } from "@/services/dashboard";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/states";
import { cn, compact, errorMessage } from "@/lib/utils";
import { CommentsSheet } from "./comments-sheet";

export const reelPostsKey = (creatorId: string) => ["reel-posts", creatorId] as const;
export const fetchReelPosts = (db: ReturnType<typeof useDb>, creatorId: string) => getCreatorPosts(db, creatorId, 0, 12);

const HEADER_H = "h-[104px]"; // fixed: the header can never change the frame's layout
const MIN_WATCH_MS = 1000;

type PostState = { liked: boolean; likes: number; saved: boolean; comments: number };

/** One creator inside the reel frame: compact header + vertically snapping posts + action rail. */
export function CreatorReel({ card, active, isBrand, onEngage }: {
  card: DeckCard;
  active: boolean;
  isBrand: boolean;
  onEngage: (creatorId: string) => void;
}) {
  const db = useDb();
  const router = useRouter();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const c = card.creator;
  const posts = useQuery({ queryKey: reelPostsKey(c.id), queryFn: () => fetchReelPosts(db, c.id) });
  const items = useMemo(() => posts.data?.items ?? [], [posts.data]);

  const [overrides, setOverrides] = useState<Record<string, PostState>>({});
  const [following, setFollowing] = useState(c.is_following);
  const [followers, setFollowers] = useState(c.followers_count);
  const [shortlisted, setShortlistedState] = useState(false);
  const [commentsFor, setCommentsFor] = useState<PostCard | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const stateOf = (p: PostCard): PostState => overrides[p.id] ?? { liked: p.liked, likes: p.likes_count, saved: p.saved, comments: p.comments_count };
  const patch = (id: string, next: PostState) => setOverrides((o) => ({ ...o, [id]: next }));
  const track = useCallback(
    (target: "profile" | "post", id: string, action: InteractionAction, context: Record<string, unknown> = {}) =>
      recordInteraction(db, target, id, action, { source: "reels", creator_id: c.id, campaign_id: card.campaignId, ...context }).catch(() => undefined),
    [db, c.id, card.campaignId],
  );
  const engaged = () => onEngage(c.id);

  // ---- Watch time: record how long each post was on screen --------------------------------
  const watch = useRef<{ id: string | null; since: number }>({ id: null, since: 0 });
  const flushWatch = useCallback(() => {
    const { id, since } = watch.current;
    if (id && since) {
      const ms = Date.now() - since;
      if (ms >= MIN_WATCH_MS) {
        track("post", id, "watch", { ms: Math.min(ms, 600_000) });
        recordPostView(db, id, Math.min(ms, 600_000));
      }
    }
    watch.current = { id: null, since: 0 };
  }, [track, db]);

  useEffect(() => {
    const root = scroller.current;
    if (!root || !active || !items.length) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const idx = Number((e.target as HTMLElement).dataset.index);
        const id = items[idx]?.id;
        if (id && id !== watch.current.id) {
          flushWatch();
          watch.current = { id, since: Date.now() };
          setActiveIdx(idx);
        }
      }
    }, { root, threshold: 0.6 });
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => { io.disconnect(); flushWatch(); };
  }, [active, items, flushWatch]);

  // ---- Keyboard: ↑ / ↓ move between this creator's posts --------------------------------------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (commentsFor || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const el = scroller.current;
      if (!el) return;
      e.preventDefault();
      el.scrollBy({ top: (e.key === "ArrowDown" ? 1 : -1) * el.clientHeight, behavior: reduce ? "auto" : "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, commentsFor, reduce]);

  // ---- Actions (optimistic, persisted, tracked) ----------------------------------------------
  async function toggleLike(p: PostCard) {
    const prev = stateOf(p);
    const next = { ...prev, liked: !prev.liked, likes: Math.max(0, prev.likes + (prev.liked ? -1 : 1)) };
    patch(p.id, next);
    try {
      await setLike(db, p.id, next.liked);
      if (next.liked) { engaged(); track("post", p.id, "like"); }
      qc.invalidateQueries({ queryKey: ["post", p.id] });
    } catch (e) { patch(p.id, prev); toast.error(errorMessage(e, "Couldn't save your like")); }
  }

  async function toggleSave(p: PostCard) {
    const prev = stateOf(p);
    const next = { ...prev, saved: !prev.saved };
    patch(p.id, next);
    try {
      await setSave(db, p.id, next.saved);
      if (next.saved) { engaged(); track("post", p.id, "save"); }
      qc.invalidateQueries({ queryKey: ["saved"] });
      toast.success(next.saved ? "Saved to your collection" : "Removed from saved");
    } catch (e) { patch(p.id, prev); toast.error(errorMessage(e, "Couldn't save that")); }
  }

  async function toggleFollow() {
    const was = following;
    setFollowing(!was);
    setFollowers((n) => Math.max(0, n + (was ? -1 : 1)));
    try {
      await setFollow(db, c.id, !was); // records the 'follow' interaction itself
      if (!was) engaged();
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e) {
      setFollowing(was);
      setFollowers((n) => Math.max(0, n + (was ? 1 : -1)));
      toast.error(errorMessage(e, "Couldn't update follow"));
    }
  }

  async function contact() {
    setBusy("contact");
    try {
      engaged();
      track("profile", c.id, "contact");
      const id = await openConversation(db, c.id);
      router.push(`/inbox/${id}`);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't open the conversation"));
      setBusy(null);
    }
  }

  async function shortlist() {
    if (!card.campaignId) return;
    setBusy("shortlist");
    try {
      await setShortlisted(db, card.campaignId, c.id, !shortlisted);
      setShortlistedState(!shortlisted);
      if (!shortlisted) engaged();
      toast.success(shortlisted ? "Removed from shortlist" : `${c.display_name} shortlisted`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const chips = [...c.tools.slice(0, 2).map((t) => ({ key: `t${t.id}`, label: t.name, verified: !!t.verified })),
                 ...c.skills.slice(0, 1).map((s) => ({ key: `s${s.id}`, label: s.name, verified: false }))];
  const strip = c.preview[0]?.url;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[2rem] bg-[#0f0d0a] text-white shadow-lift">
      {/* Compact profile header — fixed height; any banner/cover is a blurred, cropped background */}
      <header className={cn("relative shrink-0 overflow-hidden px-4 py-3", HEADER_H)}>
        {strip && <img src={strip} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 to-black/70" aria-hidden />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar src={c.avatar_url} name={c.display_name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                <span className="truncate">{c.display_name}</span>
                {c.is_verified && <BadgeCheck className="size-4 shrink-0 fill-amber text-on-amber" aria-label="Verified" />}
              </p>
              <p className="truncate text-xs text-white/70">@{c.username} · {compact(followers)} followers</p>
            </div>
          </div>
          {c.headline && <p className="truncate text-xs text-white/85">{c.headline}</p>}
          <div className="flex gap-1.5 overflow-hidden">
            {chips.map((ch) => (
              <span key={ch.key} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/12 px-2 py-0.5 text-[11px] backdrop-blur">
                {ch.verified && <BadgeCheck className="size-3" />}{ch.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* Posts: vertical scroll-snap, one per screen */}
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain scrollbar-none" aria-label={`${c.display_name}'s portfolio`}>
          {posts.isPending && (
            <div className="h-full p-4"><Skeleton className="h-full rounded-[1.5rem] !bg-white/10" /></div>
          )}
          {posts.isError && (
            <div className="grid h-full place-items-center p-6 text-center text-sm">
              <div>
                <p>Couldn&apos;t load this creator&apos;s work.</p>
                <button className="mt-2 rounded-full bg-white/15 px-4 py-2 text-xs" onClick={() => posts.refetch()}>Try again</button>
              </div>
            </div>
          )}
          {posts.isSuccess && items.length === 0 && (
            <div className="grid h-full place-items-center p-6 text-center">
              <div className="space-y-3">
                <ImageOff className="mx-auto size-8 text-white/60" />
                <p className="text-sm text-white/80">No portfolio pieces yet.</p>
                <Link href={`/u/${c.username}`} className="inline-block rounded-full bg-white/15 px-4 py-2 text-xs">View profile</Link>
              </div>
            </div>
          )}
          {items.map((p, i) => {
            const st = stateOf(p);
            return (
              <article key={p.id} data-index={i} className="relative h-full snap-start snap-always overflow-hidden" aria-label={p.title}>
                <ReelMedia post={p} playing={active && activeIdx === i} />
                {/* Caption */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-4 pt-16 pr-20">
                  {i === 0 && card.reasons.length > 0 && (
                    <p className="mb-2 flex items-center gap-1.5 truncate text-[11px] text-amber">
                      <Sparkles className="size-3 shrink-0" aria-hidden />
                      <span className="truncate"><span className="font-semibold">Why this creator?</span> {card.reasons.slice(0, 2).join(" · ")}</span>
                    </p>
                  )}
                  <h3 className="line-clamp-1 text-base font-semibold">{p.title}</h3>
                  <p className="mt-1 truncate text-xs text-white/75">{p.tools.map((t) => t.name).join(" · ") || "Tools not specified"}</p>
                </div>
                {/* Action rail */}
                <div className="absolute bottom-4 right-3 z-10 flex flex-col items-center gap-3">
                  <RailButton label={st.liked ? "Unlike" : "Like"} count={st.likes} pressed={st.liked} onClick={() => toggleLike(p)}>
                    <Heart className={cn("size-5", st.liked && "fill-rose-500 text-rose-500")} />
                  </RailButton>
                  <RailButton label="Comments" count={st.comments} onClick={() => setCommentsFor(p)}>
                    <MessageCircle className="size-5" />
                  </RailButton>
                  <RailButton label={st.saved ? "Remove from saved" : "Save"} pressed={st.saved} onClick={() => toggleSave(p)}>
                    <Bookmark className={cn("size-5", st.saved && "fill-amber text-amber")} />
                  </RailButton>
                  <RailButton label={following ? "Unfollow" : "Follow"} pressed={following} onClick={toggleFollow}>
                    {following ? <UserCheck className="size-5 text-amber" /> : <UserPlus className="size-5" />}
                  </RailButton>
                  {isBrand && card.campaignId && (
                    <RailButton label={shortlisted ? "Remove from shortlist" : "Shortlist for this brief"} pressed={shortlisted} onClick={shortlist} disabled={busy === "shortlist"}>
                      <Star className={cn("size-5", shortlisted && "fill-amber text-amber")} />
                    </RailButton>
                  )}
                  <RailButton label="Contact" onClick={contact} disabled={busy === "contact"}>
                    <Send className="size-5" />
                  </RailButton>
                  <Link href={`/u/${c.username}`} aria-label="View full profile" className="rounded-full ring-2 ring-white/70 transition-transform hover:scale-110">
                    <Avatar src={c.avatar_url} name={c.display_name} size="sm" />
                  </Link>
                </div>
                {/* Position + scroll hint */}
                {items.length > 1 && (
                  <span className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/40 px-2 py-0.5 text-[11px] tabular-nums backdrop-blur" aria-label={`Post ${i + 1} of ${items.length}`}>{i + 1}/{items.length}</span>
                )}
                {i === 0 && items.length > 1 && activeIdx === 0 && (
                  <span className="pointer-events-none absolute bottom-24 left-1/2 flex -translate-x-1/2 flex-col items-center text-[11px] text-white/70 motion-safe:animate-bounce">
                    <ChevronDown className="size-4" aria-hidden /> more work
                  </span>
                )}
              </article>
            );
          })}
        </div>
        <AnimatePresence>
          {commentsFor && (
            <CommentsSheet
              key={commentsFor.id}
              postId={commentsFor.id}
              postTitle={commentsFor.title}
              onClose={() => setCommentsFor(null)}
              onPosted={() => {
                const st = stateOf(commentsFor);
                patch(commentsFor.id, { ...st, comments: st.comments + 1 });
                engaged();
                track("post", commentsFor.id, "comment");
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RailButton({ label, count, pressed, onClick, disabled, children }: {
  label: string;
  count?: number;
  pressed?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        className="grid size-11 place-items-center rounded-full border border-white/15 bg-black/35 text-white backdrop-blur-md transition-transform hover:scale-110 active:scale-95 disabled:opacity-50"
      >
        {children}
      </button>
      {count !== undefined && <span className="text-[11px] font-medium tabular-nums text-white/90 drop-shadow">{compact(count)}</span>}
    </div>
  );
}

/** Media fitted inside a fixed box: blurred fill behind, the real asset contained in front. */
function ReelMedia({ post, playing }: { post: PostCard; playing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) v.play().catch(() => undefined);
    else v.pause();
  }, [playing]);

  const still = post.thumbnail_url ?? (post.media_type === "image" ? post.media_url : null);
  return (
    <div className="absolute inset-0 bg-black">
      {still && <img src={still} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-40 blur-2xl" />}
      {post.media_type === "video" && post.media_url ? (
        <video
          ref={video}
          src={post.media_url}
          poster={post.thumbnail_url ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={post.title}
          className="relative size-full object-contain"
        />
      ) : still ? (
        <img src={still} alt={post.title} className="relative size-full object-contain" />
      ) : (
        <div className="relative grid size-full place-items-center bg-gradient-to-br from-amber/40 to-black text-sm text-white/80">{post.title}</div>
      )}
      {post.media_type === "embed" && post.source_link && (
        <a
          href={post.source_link}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute left-1/2 top-1/2 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/55 px-4 py-2 text-sm font-medium capitalize backdrop-blur hover:bg-black/70"
        >
          Play on {post.embed_provider ?? "source"} <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}
