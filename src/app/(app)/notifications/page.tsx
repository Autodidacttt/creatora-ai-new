"use client";

import Link from "next/link";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { getNotifications, markAllNotificationsRead, markNotificationRead, notificationHref, notificationText } from "@/services/notifications";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { cn, errorMessage, timeAgo } from "@/lib/utils";

export default function NotificationsPage() {
  const db = useDb();
  const me = useMe();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ["notifications", "page"],
    queryFn: ({ pageParam }) => getNotifications(db, pageParam, 20),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["unread"] }); };
  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(db),
    onSuccess: () => { refresh(); toast.success("All caught up"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Activity</p>
          <h1 className="display text-3xl">Notifications</h1>
        </div>
        <Button size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending} disabled={!items.some((n) => !n.read_at)}><CheckCheck /> Mark all read</Button>
      </div>
      {q.isPending && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState icon={<Bell />} title="No activity yet" description="Follows, likes, comments, applications, shortlists and messages will show up here." />
      )}
      <ul className="glass divide-y divide-line overflow-hidden rounded-[2rem]">
        {items.map((n) => (
          <li key={n.id}>
            <Link
              href={notificationHref(n, me.role)}
              onClick={() => { if (!n.read_at) markNotificationRead(db, n.id).then(refresh); }}
              className={cn("flex items-start gap-3 p-4 transition-colors hover:bg-card/60", !n.read_at && "bg-amber-soft/50")}
            >
              <Avatar src={n.actor?.avatar_url} name={n.actor?.display_name ?? "Creatora"} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{notificationText(n)}</span>
                <span className="text-xs text-ink-3">{timeAgo(n.created_at)}</span>
              </span>
              {!n.read_at && <span className="mt-2 size-2 rounded-full bg-amber-2" aria-label="Unread" />}
            </Link>
          </li>
        ))}
      </ul>
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </div>
  );
}
