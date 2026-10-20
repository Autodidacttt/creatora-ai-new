"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MessageCircle, Search } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import { useDebounced } from "@/hooks/use-debounce";
import { getInbox } from "@/services/messaging";
import { Avatar } from "@/components/ui/avatar";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";

type Tab = "all" | "creator" | "brand";

export function InboxList() {
  const db = useDb();
  const me = useMe();
  const { id: activeId } = useParams<{ id?: string }>();
  const [tab, setTab] = useState<Tab>(me.role === "creator" ? "brand" : "all");
  const [query, setQuery] = useState("");
  const q = useDebounced(query, 300);
  const inbox = useInfiniteQuery({
    queryKey: ["inbox", tab, q],
    queryFn: ({ pageParam }) => getInbox(db, { otherRole: tab === "all" ? null : tab, query: q }, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex h-full flex-col gap-3">
      <h1 className="display px-1 text-2xl">Inbox</h1>
      {me.role === "creator" && (
        <SegmentedTabs size="sm" value={tab} onChange={setTab} items={[{ value: "brand", label: "Brand chats" }, { value: "creator", label: "Creator chats" }]} />
      )}
      <label className="flex h-10 items-center gap-2 rounded-full bg-card px-3 shadow-sm focus-within:ring-4 focus-within:ring-amber/25">
        <Search className="size-4 text-ink-3" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="w-full bg-transparent text-sm focus:outline-none" />
      </label>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {inbox.isPending && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="mb-2 h-16" />)}
        {inbox.isError && <ErrorState error={inbox.error} onRetry={() => inbox.refetch()} />}
        {inbox.isSuccess && items.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-ink-2">
            <MessageCircle className="mx-auto mb-2 size-6 text-ink-3" />
            {q ? "No conversations match that search." : me.role === "creator" && tab === "brand"
              ? "No brand chats yet. Apply to briefs or wait for brands to reach out."
              : "No conversations yet. Use “Contact” on any profile to start one."}
          </div>
        )}
        <ul className="space-y-1">
          {items.map((c) => (
            <li key={c.conversation_id}>
              <Link
                href={`/inbox/${c.conversation_id}`}
                aria-current={activeId === c.conversation_id ? "page" : undefined}
                className={cn("flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-card/70",
                  activeId === c.conversation_id && "bg-card shadow-sm", c.unread_count > 0 && "font-semibold")}
              >
                <Avatar src={c.other.avatar_url} name={c.other.display_name} verified={c.other.is_verified} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm">{c.other.display_name}</span>
                    <span className="shrink-0 text-[11px] font-normal text-ink-3">{timeAgo(c.last_message_at)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-xs", c.unread_count ? "text-ink" : "font-normal text-ink-3")}>
                      {c.last_sender_id === me.id && "You: "}{c.last_message_preview ?? "Say hello 👋"}
                    </span>
                    {c.unread_count > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-amber px-1.5 text-[10px] text-on-amber">{c.unread_count}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {inbox.hasNextPage && <InfiniteSentinel onVisible={() => !inbox.isFetchingNextPage && inbox.fetchNextPage()} loading={inbox.isFetchingNextPage} />}
      </div>
    </div>
  );
}
