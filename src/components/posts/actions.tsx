"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Bookmark, Heart, MessageCircle, UserCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { setFollow, setLike, setSave } from "@/services/social";
import { openConversation } from "@/services/messaging";
import { Button } from "@/components/ui/button";
import { cn, compact, errorMessage } from "@/lib/utils";

/** Optimistic toggle: flips UI instantly, persists, and rolls back on failure. */
function useOptimisticToggle(initial: boolean, initialCount: number, persist: (next: boolean) => Promise<void>, invalidate: string[][]) {
  const qc = useQueryClient();
  const [state, setState] = useState({ on: initial, count: initialCount });
  const [busy, setBusy] = useState(false);
  async function toggle() {
    if (busy) return;
    const next = !state.on;
    const prev = state;
    setState({ on: next, count: Math.max(0, state.count + (next ? 1 : -1)) });
    setBusy(true);
    try {
      await persist(next);
      invalidate.forEach((key) => qc.invalidateQueries({ queryKey: key }));
    } catch (e) {
      setState(prev);
      toast.error(errorMessage(e, "Couldn't save that — try again"));
    } finally {
      setBusy(false);
    }
  }
  return { ...state, toggle };
}

export function LikeButton({ postId, liked, count, size = "md" }: { postId: string; liked: boolean; count: number; size?: "sm" | "md" }) {
  const db = useDb();
  const s = useOptimisticToggle(liked, count, (next) => setLike(db, postId, next), [["profile"], ["post", postId]]);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); s.toggle(); }}
      aria-pressed={s.on}
      aria-label={s.on ? "Unlike" : "Like"}
      className={cn("inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
        size === "sm" ? "px-2 py-1 text-xs" : "bg-card px-3.5 py-2 text-sm shadow-sm hover:shadow-md")}
    >
      <motion.span key={String(s.on)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 15 }}>
        <Heart className={cn(size === "sm" ? "size-3.5" : "size-4", s.on && "fill-rose-500 text-rose-500")} />
      </motion.span>
      <span className="tabular-nums">{compact(s.count)}</span>
    </button>
  );
}

export function SaveButton({ postId, saved, size = "md" }: { postId: string; saved: boolean; size?: "sm" | "md" }) {
  const db = useDb();
  const s = useOptimisticToggle(saved, 0, (next) => setSave(db, postId, next), [["saved"]]);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        s.toggle();
        toast.success(s.on ? "Removed from saved" : "Saved to your collection");
      }}
      aria-pressed={s.on}
      aria-label={s.on ? "Remove from saved" : "Save"}
      className={cn("inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
        size === "sm" ? "p-1 text-xs" : "bg-card px-3.5 py-2 text-sm shadow-sm hover:shadow-md")}
    >
      <Bookmark className={cn(size === "sm" ? "size-3.5" : "size-4", s.on && "fill-amber text-amber-ink")} />
      {size === "md" && <span>{s.on ? "Saved" : "Save"}</span>}
    </button>
  );
}

export function FollowButton({ profileId, following, onChange, size = "md", className }: {
  profileId: string;
  following: boolean;
  onChange?: (following: boolean) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const db = useDb();
  const me = useMe();
  const s = useOptimisticToggle(following, 0, async (next) => {
    await setFollow(db, profileId, next);
    onChange?.(next);
  }, [["profile"], ["feed"]]);
  if (me.id === profileId) return null;
  return (
    <Button
      variant={s.on ? "secondary" : "dark"}
      size={size}
      onClick={(e) => { e.stopPropagation(); s.toggle(); }}
      aria-pressed={s.on}
      className={className}
    >
      {s.on ? <UserCheck /> : <UserPlus />} {s.on ? "Following" : "Follow"}
    </Button>
  );
}

export function ContactButton({ profileId, label = "Message", variant = "secondary", size = "md", className }: {
  profileId: string;
  label?: string;
  variant?: "secondary" | "primary" | "glass" | "dark";
  size?: "sm" | "md";
  className?: string;
}) {
  const db = useDb();
  const me = useMe();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (me.id === profileId) return null;
  return (
    <Button
      variant={variant}
      size={size}
      loading={busy}
      className={className}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        try {
          const id = await openConversation(db, profileId);
          router.push(`/inbox/${id}`);
        } catch (err) {
          toast.error(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <MessageCircle /> {label}
    </Button>
  );
}
