"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Flag, MoreHorizontal, Pencil, Send, ShieldCheck, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";
import type { PostCard } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { addComment, deleteComment, deletePost, getComments } from "@/services/posts";
import { report } from "@/services/social";
import { recordPostView } from "@/services/dashboard";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/states";
import { errorMessage, timeAgo } from "@/lib/utils";
import { LikeButton, SaveButton } from "./actions";
import { PostPlayer } from "./post-media";

export function PostDetail({ post, onDeleted }: { post: PostCard; onDeleted?: () => void }) {
  const me = useMe();
  const db = useDb();
  const router = useRouter();
  const qc = useQueryClient();
  const isOwner = me.id === post.creator.id;
  useEffect(() => { if (!isOwner) recordPostView(db, post.id); }, [db, post.id, isOwner]);

  async function remove() {
    if (!confirm("Delete this portfolio piece? This can't be undone.")) return;
    try {
      await deletePost(db, post.id);
      toast.success("Post deleted");
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["creator-posts"] });
      onDeleted?.();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function flag() {
    try {
      await report(db, { target_type: "post", target_id: post.id, reason: "misleading", details: "Reported from post view" });
      toast.success("Thanks — our trust team will review it");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <PostPlayer post={post} />
      </div>
      <div className="min-w-0 space-y-5">
        <div className="flex items-center gap-3">
          <Link href={`/u/${post.creator.username}`} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar src={post.creator.avatar_url} name={post.creator.display_name} verified={post.creator.is_verified} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{post.creator.display_name}</span>
              <span className="block truncate text-xs text-ink-3">@{post.creator.username} · {timeAgo(post.created_at)}</span>
            </span>
          </Link>
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="More actions"><MoreHorizontal /></Button>
            </MenuTrigger>
            <MenuContent>
              {isOwner ? (
                <>
                  <MenuItem onSelect={() => router.push(`/posts/${post.id}/edit`)}><Pencil /> Edit</MenuItem>
                  <MenuItem onSelect={remove} danger><Trash2 /> Delete</MenuItem>
                </>
              ) : (
                <MenuItem onSelect={flag}><Flag /> Report</MenuItem>
              )}
            </MenuContent>
          </Menu>
        </div>

        <div>
          <h1 className="display text-2xl">{post.title}</h1>
          {post.description && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{post.description}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LikeButton postId={post.id} liked={post.liked} count={post.likes_count} />
          {!isOwner && <SaveButton postId={post.id} saved={post.saved} />}
        </div>

        {/* AI tools used */}
        <section aria-labelledby="tools-h">
          <h2 id="tools-h" className="eyebrow mb-2">AI tools & models</h2>
          <div className="flex flex-wrap gap-1.5">
            {post.tools.length ? post.tools.map((t) => <Chip key={t.id} tone="glass">{t.name}</Chip>) : <span className="text-sm text-ink-3">Not specified</span>}
          </div>
        </section>

        {/* Workflow pipeline */}
        {post.workflow_steps.length > 0 && (
          <section aria-labelledby="wf-h">
            <h2 id="wf-h" className="eyebrow mb-2 flex items-center gap-1.5">
              <Workflow className="size-3.5" /> Workflow
              {post.workflow_verified && <Chip tone="amber" icon={<ShieldCheck />} className="ml-1 normal-case tracking-normal">Documented & verified</Chip>}
            </h2>
            <ol className="flex flex-wrap items-center gap-1.5">
              {post.workflow_steps.map((s, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="rounded-2xl bg-card px-3 py-2 text-xs shadow-sm">
                    <span className="block font-semibold">{s.tool ?? "Manual"}</span>
                    <span className="text-ink-2">{s.step}</span>
                  </span>
                  {i < post.workflow_steps.length - 1 && <ArrowRight className="size-3.5 text-ink-3" aria-hidden />}
                </li>
              ))}
            </ol>
          </section>
        )}
        {post.workflow_notes && (
          <p className="rounded-2xl bg-amber-soft/70 px-4 py-3 text-sm leading-relaxed">{post.workflow_notes}</p>
        )}

        {/* Specs */}
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {[
            ["Content type", post.content_type?.name],
            ["Style", post.style?.name],
            ["Format", post.aspect_ratio],
            ["Category", post.category?.name],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-card px-3 py-2">
              <dt className="text-xs text-ink-3">{k}</dt>
              <dd className="font-medium">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <div className="flex items-center gap-2 text-sm">
          {post.commercial_use_cleared ? (
            <Chip tone="success" icon={<BadgeCheck />}>Cleared for commercial use</Chip>
          ) : (
            <Chip tone="outline">Commercial use not cleared — ask the creator</Chip>
          )}
        </div>

        <Comments postId={post.id} postOwnerId={post.creator.id} />
      </div>
    </div>
  );
}

function Comments({ postId, postOwnerId }: { postId: string; postOwnerId: string }) {
  const db = useDb();
  const me = useMe();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const comments = useQuery({ queryKey: ["comments", postId], queryFn: () => getComments(db, postId) });
  const send = useMutation({
    mutationFn: (text: string) => addComment(db, postId, text),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["comments", postId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(db, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comments", postId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <section aria-labelledby="comments-h" className="space-y-3 border-t border-line pt-4">
      <h2 id="comments-h" className="eyebrow">Comments {comments.data ? `(${comments.data.length})` : ""}</h2>
      {comments.isPending && <Skeleton className="h-16" />}
      {comments.isError && <p className="text-sm text-danger">Couldn&apos;t load comments. <button className="underline" onClick={() => comments.refetch()}>Retry</button></p>}
      {comments.data?.length === 0 && <p className="text-sm text-ink-3">No comments yet — start the conversation.</p>}
      <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {comments.data?.map((c) => (
          <li key={c.id} className="group flex gap-2.5">
            <Avatar src={c.author.avatar_url} name={c.author.display_name} size="sm" />
            <div className="min-w-0 flex-1 rounded-2xl bg-card px-3 py-2">
              <p className="text-xs"><Link href={`/u/${c.author.username}`} className="font-semibold">{c.author.display_name}</Link> <span className="text-ink-3">· {timeAgo(c.created_at)}</span></p>
              <p className="mt-0.5 whitespace-pre-line break-words text-sm">{c.body}</p>
            </div>
            {(c.author.id === me.id || postOwnerId === me.id) && (
              <button aria-label="Delete comment" onClick={() => remove.mutate(c.id)} className="self-center text-ink-3 opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(body.trim()); }}
        className="flex items-center gap-2 rounded-full bg-card p-1 pl-4 shadow-sm"
      >
        <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder="Add a comment…" aria-label="Add a comment"
          className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none" />
        <Button type="submit" size="icon-sm" variant="primary" loading={send.isPending} disabled={!body.trim()} aria-label="Post comment"><Send /></Button>
      </form>
    </section>
  );
}
