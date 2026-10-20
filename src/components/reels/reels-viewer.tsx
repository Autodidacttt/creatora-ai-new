"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Layers, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useDb } from "@/features/session";
import { getSwipeDeck, type DeckCard } from "@/services/discovery";
import { recordInteraction } from "@/services/social";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreatorReel, fetchReelPosts, reelPostsKey } from "./creator-reel";

const PAGE = 15;

/** Reels-style viewer: one creator at a time; arrows / ←→ switch creators, scrolling moves through posts. */
export function ReelsViewer({ campaignId, isBrand }: { campaignId: string | null; isBrand: boolean }) {
  const db = useDb();
  const qc = useQueryClient();
  const [includeSeen, setIncludeSeen] = useState(false);
  const deck = useQuery({
    queryKey: ["reels-deck", campaignId, includeSeen],
    queryFn: () => getSwipeDeck(db, campaignId, PAGE, includeSeen),
    staleTime: Infinity,
  });

  const [cards, setCards] = useState<DeckCard[]>([]);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const engagedRef = useRef(new Set<string>());
  const enteredAt = useRef(0);

  // A fresh deck from the server (first load or Reset) replaces the local list — derived during render
  const [syncedAt, setSyncedAt] = useState(0);
  if (deck.data && deck.dataUpdatedAt !== syncedAt) {
    setSyncedAt(deck.dataUpdatedAt);
    setCards(deck.data);
    setIndex(0);
    setExhausted(deck.data.length < PAGE);
  }

  const current = cards[index];
  const currentId = current?.creator.id;
  useEffect(() => { enteredAt.current = Date.now(); }, [currentId]);

  const track = useCallback((creatorId: string, action: "navigate" | "skip", context: Record<string, unknown>) => {
    recordInteraction(db, "profile", creatorId, action, { source: "reels", campaign_id: campaignId, ...context }).catch(() => undefined);
  }, [db, campaignId]);

  const loadMore = useCallback(async () => {
    if (exhausted || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await getSwipeDeck(db, campaignId, PAGE, includeSeen);
      const known = new Set(cards.map((c) => c.creator.id));
      const fresh = more.filter((c) => !known.has(c.creator.id));
      if (fresh.length) setCards((list) => [...list, ...fresh.filter((c) => !list.some((x) => x.creator.id === c.creator.id))]);
      else setExhausted(true);
    } catch {
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [db, campaignId, includeSeen, exhausted, loadingMore, cards]);

  const next = useCallback(() => {
    const cur = cards[index];
    if (!cur) return;
    const dwell = Date.now() - enteredAt.current;
    const engaged = engagedRef.current.has(cur.creator.id);
    track(cur.creator.id, "navigate", { direction: "next", dwell_ms: dwell, engaged });
    if (!engaged) track(cur.creator.id, "skip", { dwell_ms: dwell });
    setDir(1);
    setIndex((i) => i + 1);
    if (index + 1 >= cards.length - 2) loadMore();
  }, [cards, index, track, loadMore]);

  const prev = useCallback(() => {
    if (index === 0) return;
    const target = cards[index - 1];
    if (target) track(target.creator.id, "navigate", { direction: "prev" });
    setDir(-1);
    setIndex((i) => i - 1);
  }, [cards, index, track]);

  // ← / → switch creators (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // Preload the next creator: their posts and first images, so switching is instant
  useEffect(() => {
    const upcoming = cards[index + 1];
    if (!upcoming) return;
    const id = upcoming.creator.id;
    if (upcoming.creator.avatar_url) new Image().src = upcoming.creator.avatar_url;
    upcoming.creator.preview.slice(0, 2).forEach((p) => { if (p.url) new Image().src = p.url; });
    qc.prefetchQuery({ queryKey: reelPostsKey(id), queryFn: () => fetchReelPosts(db, id), staleTime: 60_000 }).then(() => {
      const data = qc.getQueryData<Awaited<ReturnType<typeof fetchReelPosts>>>(reelPostsKey(id));
      data?.items.slice(0, 2).forEach((p) => {
        const src = p.thumbnail_url ?? (p.media_type === "image" ? p.media_url : null);
        if (src) new Image().src = src;
      });
    });
  }, [cards, index, qc, db]);

  const reset = () => {
    engagedRef.current.clear();
    setExhausted(false);
    setIncludeSeen(true);
    if (includeSeen) deck.refetch();
  };

  const atEnd = !current && (exhausted || cards.length === 0) && !loadingMore;
  const canPrev = index > 0;
  const canNext = !!current;

  return (
    <div className="flex h-full min-h-0 items-center justify-center gap-4">
      <ArrowButton direction="prev" onClick={prev} disabled={!canPrev} className="hidden md:grid" />

      <div className="relative h-full w-full max-w-[480px]" aria-live="polite">
        {deck.isPending && <FrameSkeleton />}
        {deck.isError && (
          <div className="grid h-full place-items-center"><ErrorState error={deck.error} onRetry={() => deck.refetch()} /></div>
        )}

        {deck.isSuccess && (
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            {current ? (
              <motion.div
                key={current.creator.id}
                custom={dir}
                variants={{
                  enter: (d: number) => ({ x: d * 64, opacity: 0 }),
                  center: { x: 0, opacity: 1 },
                  exit: (d: number) => ({ x: d * -64, opacity: 0 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 320, damping: 34, opacity: { duration: 0.18 } }}
                className="absolute inset-0"
              >
                <CreatorReel card={current} active isBrand={isBrand} onEngage={(id) => engagedRef.current.add(id)} />
              </motion.div>
            ) : atEnd ? (
              <motion.div key="end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="glass absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-[2rem] p-8 text-center">
                <span className="grid size-14 place-items-center rounded-full bg-amber-soft"><Layers className="size-6" /></span>
                <h2 className="display text-2xl">You&apos;ve seen everyone</h2>
                <p className="max-w-xs text-sm text-ink-2">New creators show up here as they join. Start over, or narrow things down with filters.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={reset} className={buttonVariants({ variant: "primary" })}><RotateCcw /> Reset</button>
                  <Link href="/discover" className={buttonVariants({ variant: "secondary" })}><SlidersHorizontal /> Adjust filters</Link>
                </div>
                {canPrev && <button onClick={prev} className="text-xs text-ink-2 underline-offset-4 hover:underline">← Back to the last creator</button>}
              </motion.div>
            ) : (
              <motion.div key="loading" className="absolute inset-0"><FrameSkeleton /></motion.div>
            )}
          </AnimatePresence>
        )}

        {/* Mobile: arrows overlay the frame edges, just below the header */}
        <ArrowButton direction="prev" onClick={prev} disabled={!canPrev} className="absolute left-2 top-[116px] z-20 grid size-10 md:hidden" />
        <ArrowButton direction="next" onClick={next} disabled={!canNext} className="absolute right-2 top-[116px] z-20 grid size-10 md:hidden" />
      </div>

      <ArrowButton direction="next" onClick={next} disabled={!canNext} className="hidden md:grid" />
    </div>
  );
}

function ArrowButton({ direction, onClick, disabled, className }: { direction: "prev" | "next"; onClick: () => void; disabled?: boolean; className?: string }) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous creator (Left arrow)" : "Next creator (Right arrow)"}
      className={cn(
        "glass size-12 shrink-0 place-items-center rounded-full text-ink transition-transform hover:scale-110 active:scale-95 disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

function FrameSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[2rem] bg-ink/[0.06]" aria-busy="true" aria-label="Loading creator">
      <div className="flex h-[104px] shrink-0 items-center gap-3 px-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>
      </div>
      <Skeleton className="m-3 mt-0 flex-1 rounded-[1.5rem]" />
    </div>
  );
}
