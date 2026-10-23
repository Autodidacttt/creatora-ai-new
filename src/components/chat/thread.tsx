"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Send, Users, Workflow } from "lucide-react";
import { toast } from "sonner";
import type { Message } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { getConversation, getMessages, getNegotiation, markConversationRead, sendMessage } from "@/services/messaging";
import { messageSchema } from "@/lib/validation/schemas";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { cn, errorMessage } from "@/lib/utils";
import { NegotiationCard, StructuredMessage } from "./negotiation";

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function Thread({ conversationId }: { conversationId: string }) {
  const db = useDb();
  const me = useMe();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => getConversation(db, conversationId) });
  const isGroup = info.data?.type === "group";
  const peer = info.data ? { data: isGroup ? null : info.data.members.find((x) => x.id !== me.id) ?? null } : { data: undefined };
  // Campaign 1:1 chats carry the hiring negotiation (pinned card); null for plain DMs and groups
  const negotiation = useQuery({
    queryKey: ["negotiation", conversationId],
    queryFn: () => getNegotiation(db, conversationId),
    enabled: !!info.data?.campaign && !isGroup,
  });
  const names = new Map((info.data?.members ?? []).map((x) => [x.id, x.display_name]));
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [body, setBody] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useCallback(() => {
    markConversationRead(db, conversationId).then(() => {
      qc.invalidateQueries({ queryKey: ["unread"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
    }).catch(() => undefined);
  }, [db, conversationId, qc]);

  // Latest page from the server; older pages and realtime inserts are layered on locally
  const latest = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => getMessages(db, conversationId),
    staleTime: 0,
    gcTime: 0,
  });
  const [syncedAt, setSyncedAt] = useState(0);
  if (latest.data && latest.dataUpdatedAt !== syncedAt) {
    setSyncedAt(latest.dataUpdatedAt);
    setMessages(latest.data.items);
    setHasMore(latest.data.hasMore);
  }
  const state = latest.isError ? "error" : latest.isPending ? "loading" : "ready";
  const error = latest.error;

  useEffect(() => { if (latest.isSuccess) markRead(); }, [latest.isSuccess, markRead]);

  // Live updates
  useEffect(() => {
    const channel = db
      .channel(`thread:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const m = payload.new as Message;
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list.filter((x) => !(x.pending && x.body === m.body && m.sender_id === me.id)), m]));
        if (m.sender_id !== me.id) markRead();
        if (m.kind && m.kind !== "user") qc.invalidateQueries({ queryKey: ["negotiation", conversationId] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const m = payload.new as Message;
        setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
        qc.invalidateQueries({ queryKey: ["negotiation", conversationId] });
      })
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [db, conversationId, me.id, markRead, qc]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    if (!messages[0]) return;
    setLoadingOlder(true);
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const page = await getMessages(db, conversationId, messages[0].created_at);
      stickToBottom.current = false;
      setMessages((list) => [...page.items, ...list]);
      setHasMore(page.hasMore);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const parsed = messageSchema.safeParse({ body });
    if (!parsed.success) return;
    const temp: Message = { id: `tmp-${crypto.randomUUID()}`, conversation_id: conversationId, sender_id: me.id, body: parsed.data.body, created_at: new Date().toISOString(), pending: true };
    stickToBottom.current = true;
    setMessages((list) => [...list, temp]);
    setBody("");
    try {
      const saved = await sendMessage(db, conversationId, parsed.data.body);
      setMessages((list) => {
        const without = list.filter((x) => x.id !== temp.id);
        return without.some((x) => x.id === saved.id) ? without : [...without, saved];
      });
      qc.invalidateQueries({ queryKey: ["inbox"] });
    } catch (err) {
      setMessages((list) => list.filter((x) => x.id !== temp.id));
      setBody(parsed.data.body);
      toast.error(errorMessage(err, "Message not sent"));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line pb-3">
        <Link href="/inbox" className="grid size-9 place-items-center rounded-full hover:bg-ink/5 lg:hidden" aria-label="Back to inbox"><ArrowLeft className="size-5" /></Link>
        {isGroup && info.data ? (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-soft"><Users className="size-5" /></span>
            <span className="min-w-0">
              <span className="block truncate font-semibold">{info.data.campaign?.title ?? "Group"}</span>
              <span className="block truncate text-xs text-ink-3">Group · {info.data.members.map((x) => (x.id === me.id ? "You" : x.display_name)).join(", ")}</span>
            </span>
          </div>
        ) : peer.data ? (
          <Link href={`/u/${peer.data.username}`} className="flex min-w-0 items-center gap-3">
            <Avatar src={peer.data.avatar_url} name={peer.data.display_name} verified={peer.data.is_verified} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{peer.data.display_name}</span>
              <span className="block truncate text-xs text-ink-3">@{peer.data.username}</span>
            </span>
            <Chip tone="outline" className="capitalize">{peer.data.role}</Chip>
            {info.data?.campaign && <span className="hidden truncate text-xs text-ink-3 sm:inline">re: {info.data.campaign.title}</span>}
          </Link>
        ) : info.isError ? <span className="text-sm text-danger">Conversation unavailable</span> : <Skeleton className="h-10 w-48" />}
      </header>

      <div ref={scroller} onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }} className="min-h-0 flex-1 space-y-1 overflow-y-auto py-4" aria-live="polite">
        {negotiation.data && <div className="sticky top-0 z-10 bg-bg/95 pb-2 backdrop-blur-sm"><NegotiationCard conversationId={conversationId} n={negotiation.data} /></div>}
        {state === "loading" && <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className={cn("h-10 w-2/3", i % 2 && "ml-auto")} />)}</div>}
        {state === "error" && <ErrorState error={error} onRetry={() => latest.refetch()} />}
        {state === "ready" && hasMore && (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="ghost" onClick={loadOlder} loading={loadingOlder}>Load earlier messages</Button>
          </div>
        )}
        {state === "ready" && messages.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-2">No messages yet — introduce yourself and what you&apos;re working on.</p>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === me.id;
          const newDay = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
          if (m.kind === "system") {
            return (
              <div key={m.id}>
                {newDay && <p className="py-3 text-center text-[11px] font-medium uppercase tracking-wider text-ink-3">{dayLabel(m.created_at)}</p>}
                <div className="flex justify-center py-1.5">
                  <p className="flex max-w-[88%] items-start gap-2 rounded-2xl border border-line bg-card/60 px-3.5 py-2 text-xs text-ink-2">
                    <Workflow className="mt-0.5 size-3.5 shrink-0 text-amber-2" aria-hidden />
                    <span><span className="sr-only">Project update: </span>{m.body}</span>
                  </p>
                </div>
              </div>
            );
          }
          if (m.kind === "offer" || m.kind === "proposal" || m.kind === "task") {
            return (
              <div key={m.id} className="py-1">
                {newDay && <p className="py-3 text-center text-[11px] font-medium uppercase tracking-wider text-ink-3">{dayLabel(m.created_at)}</p>}
                <StructuredMessage m={m} mine={mine} n={negotiation.data} conversationId={conversationId} />
              </div>
            );
          }
          return (
            <div key={m.id}>
              {newDay && <p className="py-3 text-center text-[11px] font-medium uppercase tracking-wider text-ink-3">{dayLabel(m.created_at)}</p>}
              {isGroup && !mine && (i === 0 || messages[i - 1].sender_id !== m.sender_id || messages[i - 1].kind !== m.kind) && (
                <p className="px-3 pt-1 text-[11px] font-medium text-ink-3">{names.get(m.sender_id) ?? "Member"}</p>
              )}
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[78%] whitespace-pre-line break-words rounded-3xl px-4 py-2.5 text-sm",
                  mine ? "rounded-br-lg bg-amber text-on-amber" : "rounded-bl-lg bg-card shadow-sm", m.pending && "opacity-60")}>
                  {m.body}
                  <span className={cn("mt-0.5 block text-right text-[10px]", mine ? "text-on-amber/60" : "text-ink-3")}>
                    {m.pending ? <Loader2 className="inline size-3 animate-spin" /> : new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={send} className="flex items-end gap-2 rounded-[1.75rem] bg-card p-1.5 pl-4 shadow-sm">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          rows={1}
          maxLength={4000}
          placeholder="Write a message…"
          aria-label="Message"
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-sm focus:outline-none"
        />
        <Button type="submit" variant="primary" size="icon" disabled={!body.trim()} aria-label="Send"><Send /></Button>
      </form>
    </div>
  );
}
