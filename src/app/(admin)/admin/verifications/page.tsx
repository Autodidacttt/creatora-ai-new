"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, ExternalLink, ShieldCheck, X } from "lucide-react";
import { useDb } from "@/features/session";
import { listVerifications } from "@/services/admin";
import { VERIFICATION_TYPES } from "@/config/constants";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { timeAgo } from "@/lib/utils";

export default function AdminVerifications() {
  const db = useDb();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const q = useQuery({ queryKey: ["admin", "verifications", status], queryFn: () => listVerifications(db, status) });
  const { busy, run } = useAdminAction();

  return (
    <div className="space-y-5">
      <h1 className="display text-3xl">Verification queue</h1>
      <p className="text-sm text-ink-2">Approving an identity check also marks the creator as Verified. Every decision is audit-logged and the creator is notified.</p>
      <SegmentedTabs value={status} onChange={setStatus} items={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} />
      {q.isPending && [0, 1].map((i) => <Skeleton key={i} className="h-32" />)}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState icon={<ShieldCheck />} title={status === "pending" ? "Queue is clear" : `No ${status} verifications`} />}
      <ul className="space-y-3">
        {q.data?.map((v) => (
          <li key={v.id} className="glass rounded-[1.75rem] p-5">
            <div className="flex flex-wrap items-start gap-3">
              <Link href={`/u/${v.creator.username}`} className="flex items-center gap-3">
                <Avatar src={v.creator.avatar_url} name={v.creator.display_name} verified={v.creator.is_verified} />
                <span className="text-sm font-semibold">{v.creator.display_name}</span>
              </Link>
              <Chip tone="amber">{VERIFICATION_TYPES[v.type as keyof typeof VERIFICATION_TYPES]?.label ?? v.type}</Chip>
              <span className="ml-auto text-xs text-ink-3">requested {timeAgo(v.created_at)}</span>
            </div>
            <p className="mt-3 font-semibold">{v.title}</p>
            <p className="text-sm text-ink-2">Subject: {v.subject}</p>
            {v.evidence_notes && <p className="mt-2 rounded-2xl bg-card p-3 text-sm">{v.evidence_notes}</p>}
            {v.evidence_url && (
              <a href={v.evidence_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm underline">
                Evidence <ExternalLink className="size-3.5" />
              </a>
            )}
            {status === "pending" && (
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="primary" loading={busy === `a-${v.id}`} onClick={() => run(`a-${v.id}`, { action: "review_verification", verification_id: v.id, status: "approved" }, "Approved")}>
                  <BadgeCheck /> Approve
                </Button>
                <Button size="sm" variant="danger" loading={busy === `r-${v.id}`} onClick={() => run(`r-${v.id}`, { action: "review_verification", verification_id: v.id, status: "rejected" }, "Rejected")}>
                  <X /> Reject
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
