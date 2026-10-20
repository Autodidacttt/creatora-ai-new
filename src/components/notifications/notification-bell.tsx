"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { getNotifications, markAllNotificationsRead, markNotificationRead, notificationHref, notificationText } from "@/services/notifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/states";
import { cn, errorMessage, timeAgo } from "@/lib/utils";

export function NotificationBell({ unread }: { unread: number }) {
  const db = useDb();
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["notifications", "dropdown"], queryFn: () => getNotifications(db, 0, 8) });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(db),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["unread"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="glass relative grid size-11 place-items-center rounded-full transition-transform hover:scale-105"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-amber px-1 text-[10px] font-bold text-on-amber">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-2">
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <h2 className="display text-base">Notifications</h2>
          <button
            onClick={() => markAll.mutate()}
            disabled={!unread || markAll.isPending}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-ink-2 hover:bg-ink/5 disabled:opacity-40"
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {list.isPending && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="m-2 h-12" />)}
          {list.isError && (
            <p className="px-3 py-6 text-center text-sm text-ink-2">
              Couldn&apos;t load notifications. <button className="underline" onClick={() => list.refetch()}>Retry</button>
            </p>
          )}
          {list.data?.items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-2">You&apos;re all caught up. Activity on your work shows up here.</p>
          )}
          {list.data?.items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (!n.read_at) {
                  markNotificationRead(db, n.id).then(() => {
                    qc.invalidateQueries({ queryKey: ["unread"] });
                    qc.invalidateQueries({ queryKey: ["notifications"] });
                  });
                }
                router.push(notificationHref(n, me.role));
              }}
              className={cn("flex w-full items-start gap-3 rounded-2xl p-2.5 text-left transition-colors hover:bg-ink/5", !n.read_at && "bg-amber-soft/60")}
            >
              <Avatar src={n.actor?.avatar_url} name={n.actor?.display_name ?? "Creatora"} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm">{notificationText(n)}</span>
                <span className="text-xs text-ink-3">{timeAgo(n.created_at)}</span>
              </span>
              {!n.read_at && <span className="mt-2 size-2 shrink-0 rounded-full bg-amber-2" aria-label="Unread" />}
            </button>
          ))}
        </div>
        <Link href="/notifications" className="mt-1 block rounded-xl py-2 text-center text-sm font-medium hover:bg-ink/5">
          See all activity
        </Link>
      </PopoverContent>
    </Popover>
  );
}
