"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Send, X } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { addComment, getComments } from "@/services/posts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { errorMessage, timeAgo } from "@/lib/utils";

/** Bottom sheet inside the reel frame: real comments for one post, with posting. */
export function CommentsSheet({ postId, postTitle, onClose, onPosted }: {
  postId: string;
  postTitle: string;
  onClose: () => void;
  onPosted: () => void;
}) {
  const db = useDb();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const comments = useQuery({ queryKey: ["comments", postId], queryFn: () => getComments(db, postId) });
  const send = useMutation({
    mutationFn: (text: string) => addComment(db, postId, text),
    onSuccess: () => {
      setBody("");
      onPosted();
      qc.invalidateQueries({ queryKey: ["comments", postId] });
    },
    onError: (e) => toast.error(errorMessage(e, "Comment not posted")),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.section
      role="dialog"
      aria-label={`Comments on ${postTitle}`}
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      className="absolute inset-x-0 bottom-0 z-30 flex h-[72%] flex-col rounded-t-[1.75rem] bg-card text-ink shadow-lift"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">Comments {comments.data ? `· ${comments.data.length}` : ""}</h2>
        <Button size="icon-sm" variant="ghost" aria-label="Close comments" onClick={onClose}><X /></Button>
      </header>
      <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 overscroll-contain">
        {comments.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
        {comments.isError && (
          <li className="text-sm text-danger">Couldn&apos;t load comments. <button className="underline" onClick={() => comments.refetch()}>Retry</button></li>
        )}
        {comments.data?.length === 0 && <li className="py-6 text-center text-sm text-ink-3">No comments yet — be the first.</li>}
        {comments.data?.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar src={c.author.avatar_url} name={c.author.display_name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-xs">
                <Link href={`/u/${c.author.username}`} className="font-semibold">{c.author.display_name}</Link>{" "}
                <span className="text-ink-3">{timeAgo(c.created_at)}</span>
              </p>
              <p className="whitespace-pre-line break-words text-sm">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(body.trim()); }}
        className="flex shrink-0 items-center gap-2 border-t border-line p-3"
      >
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          autoFocus
          className="h-10 min-w-0 flex-1 rounded-full bg-ink/5 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-amber/50"
        />
        <Button type="submit" size="icon" variant="primary" aria-label="Post comment" loading={send.isPending} disabled={!body.trim()}><Send /></Button>
      </form>
    </motion.section>
  );
}
