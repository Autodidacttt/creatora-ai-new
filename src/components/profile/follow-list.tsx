"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useDb } from "@/features/session";
import { getFollowList } from "@/services/profiles";
import { Dialog } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/avatar";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { FollowButton } from "@/components/posts/actions";

export function FollowListDialog({ userId, kind, onClose }: { userId: string; kind: "followers" | "following" | null; onClose: () => void }) {
  const db = useDb();
  const list = useQuery({
    queryKey: ["follow-list", userId, kind],
    queryFn: () => getFollowList(db, userId, kind!),
    enabled: !!kind,
  });
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()} title={kind === "following" ? "Following" : "Followers"} size="sm">
      {list.isPending && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data?.items.length === 0 && <p className="py-6 text-center text-sm text-ink-2">Nobody here yet.</p>}
      <ul className="space-y-1">
        {list.data?.items.map(({ profile, is_following }) => (
          <li key={profile.id} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-ink/5">
            <Link href={`/u/${profile.username}`} onClick={onClose} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar src={profile.avatar_url} name={profile.display_name} verified={profile.is_verified} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{profile.display_name}</span>
                <span className="block truncate text-xs text-ink-3">@{profile.username}</span>
              </span>
            </Link>
            <FollowButton profileId={profile.id} following={is_following} size="sm" />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
