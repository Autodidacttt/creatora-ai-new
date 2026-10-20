"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { useDb } from "@/features/session";
import { auditLog } from "@/services/admin";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { timeAgo } from "@/lib/utils";

export default function AdminAudit() {
  const db = useDb();
  const q = useQuery({ queryKey: ["admin", "audit"], queryFn: () => auditLog(db) });
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl">Audit log</h1>
      {q.isPending && <Skeleton className="h-40" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState icon={<ClipboardList />} title="No admin actions yet" description="Every moderation action is recorded here." />}
      <ul className="glass divide-y divide-line overflow-hidden rounded-[2rem]">
        {q.data?.map((a) => (
          <li key={a.id} className="flex items-center gap-3 p-4 text-sm">
            <Avatar src={a.actor?.avatar_url} name={a.actor?.display_name ?? "System"} size="sm" />
            <span className="min-w-0 flex-1">
              <strong>{a.actor?.display_name ?? "System"}</strong> · <code className="rounded bg-ink/5 px-1.5 text-xs">{a.action}</code> on {a.target_type}
              <span className="block truncate text-xs text-ink-3">{a.target_id} · {JSON.stringify(a.meta)}</span>
            </span>
            <span className="shrink-0 text-xs text-ink-3">{timeAgo(a.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
