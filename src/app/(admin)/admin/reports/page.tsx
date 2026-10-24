"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, EyeOff, Flag, X } from "lucide-react";
import { useDb } from "@/features/session";
import { listReports } from "@/services/admin";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { timeAgo } from "@/lib/utils";

export default function AdminReports() {
  const db = useDb();
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed">("open");
  const q = useQuery({ queryKey: ["admin", "reports", status], queryFn: () => listReports(db, status) });
  const { busy, run } = useAdminAction();

  return (
    <div className="space-y-5">
      <h1 className="display text-3xl">Reports</h1>
      <SegmentedTabs value={status} onChange={setStatus} items={[{ value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "dismissed", label: "Dismissed" }]} />
      {q.isPending && <Skeleton className="h-32" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState icon={<Flag />} title={status === "open" ? "No open reports" : `No ${status} reports`} />}
      <ul className="space-y-3">
        {q.data?.map((r) => (
          <li key={r.id} className="glass rounded-[1.75rem] p-5">
            <div className="flex flex-wrap items-center gap-2">
              {r.priority === "high" && <Chip tone="dark">High priority</Chip>}
              <Chip tone="danger" className="capitalize">{r.reason.replace("_", " ")}</Chip>
              <Chip tone="outline" className="capitalize">{r.target_type}</Chip>
              {r.target_removed && <Chip tone="dark">Removed</Chip>}
              <span className="ml-auto flex items-center gap-2 text-xs text-ink-3">
                <Avatar src={r.reporter.avatar_url} name={r.reporter.display_name} size="xs" /> {r.reporter.display_name} · {timeAgo(r.created_at)}
              </span>
            </div>
            <p className="mt-3 font-semibold">
              {r.target_type === "post" ? <Link href={`/post/${r.target_id}`} className="underline-offset-4 hover:underline">{r.target_label ?? "Deleted post"}</Link> : r.target_label ?? r.target_id}
            </p>
            {r.details && <p className="mt-1 text-sm text-ink-2">{r.details}</p>}
            {status === "open" && (
              <div className="mt-4 flex flex-wrap gap-2">
                {r.target_type === "post" && !r.target_removed && (
                  <Button size="sm" variant="danger" loading={busy === `rm-${r.id}`}
                    onClick={() => run(`rm-${r.id}`, { action: "set_post_removed", post_id: r.target_id, value: true }, "Content removed")}>
                    <EyeOff /> Remove content
                  </Button>
                )}
                <Button size="sm" variant="primary" loading={busy === `ok-${r.id}`} onClick={() => run(`ok-${r.id}`, { action: "resolve_report", report_id: r.id, status: "resolved" }, "Report resolved")}><Check /> Resolve</Button>
                <Button size="sm" loading={busy === `no-${r.id}`} onClick={() => run(`no-${r.id}`, { action: "resolve_report", report_id: r.id, status: "dismissed" }, "Report dismissed")}><X /> Dismiss</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
