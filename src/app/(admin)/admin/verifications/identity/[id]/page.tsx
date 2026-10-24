"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FlaskConical, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { decideIdentity, getIdentityVerification, viewIdImage } from "@/services/verification";
import { ID_TYPES } from "@/config/verification";
import { labelOf } from "@/config/constants";
import { GlassPanel } from "@/components/ui/glass";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { StatusChip } from "@/components/admin/verification-status";
import { AuditList, DecisionBar, HistoryList, PhoneField } from "@/components/admin/verification-detail";
import { TrustBadges } from "@/components/verification/trust-badges";
import { errorMessage, timeAgo } from "@/lib/utils";

export default function IdentityVerificationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const db = useDb();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "identity-detail", id], queryFn: () => getIdentityVerification(db, id) });
  const [image, setImage] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data;

  return (
    <div className="space-y-5">
      <Link href={`/admin/verifications?tab=${v.kind === "creator" ? "creators" : "recruiters"}`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Verifications</Link>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar src={v.user.avatar_url} name={v.user.display_name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="display text-2xl">{v.full_name}</h1>
          <p className="text-sm text-ink-3">
            <Link href={`/u/${v.user.username}`} className="underline-offset-4 hover:underline">@{v.user.username}</Link> · {v.kind === "creator" ? "Creator" : "Individual Recruiter"} · submitted {timeAgo(v.created_at)}
          </p>
          <TrustBadges badges={v.user} role={v.kind === "creator" ? "creator" : "brand"} className="mt-1" />
        </div>
        <StatusChip status={v.status} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <GlassPanel className="space-y-4 p-5 sm:p-6">
          <h2 className="display text-lg">Submitted details</h2>
          <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-3">Full name</dt><dd>{v.full_name}</dd>
            <dt className="text-ink-3">ID type</dt><dd>{labelOf(ID_TYPES, v.id_type)}</dd>
            <dt className="text-ink-3">ID number</dt><dd className="font-mono">••••{v.id_last4} <span className="font-sans text-xs text-ink-3">(stored as a hash)</span></dd>
            <dt className="text-ink-3">Date of birth</dt><dd>{v.dob}</dd>
            <dt className="text-ink-3">Phone</dt><dd><PhoneField kind="identity" id={v.id} phone={v.phone} /></dd>
            <dt className="text-ink-3">Consent</dt><dd>Given {timeAgo(v.consent_at)}</dd>
          </dl>
          <div className="rounded-2xl bg-card/70 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" /> Automated ID check: {v.mock_check?.result ?? "running…"}</p>
            <p className="text-xs text-ink-3">Simulated check, not a government verification. Advisory only — your decision is final.</p>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Government ID image</h3>
            {!v.has_image ? <p className="text-sm text-ink-3">{v.image_deleted_at ? `Deleted under the retention policy ${timeAgo(v.image_deleted_at)}.` : "No image."}</p>
              : image ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from the private bucket
                <img src={image} alt={`Government ID submitted by ${v.full_name}`} className="max-h-[28rem] w-full rounded-2xl bg-card object-contain" />
              ) : (
                <Button variant="secondary" loading={loadingImage} onClick={async () => {
                  setLoadingImage(true);
                  try { setImage((await viewIdImage(v.id)).url); } catch (e) { toast.error(errorMessage(e)); } finally { setLoadingImage(false); }
                }}><ImageIcon /> View ID image (logged)</Button>
              )}
            {v.delete_after && v.has_image && <p className="text-xs text-ink-3">Scheduled for deletion after the retention period.</p>}
          </div>
          {v.status === "pending" ? (
            <DecisionBar onDecide={async (d, reason) => {
              await decideIdentity(db, v.id, d, reason);
              toast.success(d === "verified" ? "Marked Identity Verified" : "Rejected");
              qc.invalidateQueries({ queryKey: ["admin"] });
            }} />
          ) : (
            <p className="text-sm">Decided {v.reviewed_at ? timeAgo(v.reviewed_at) : ""} by {v.reviewed_by?.display_name ?? "—"}{v.reason ? ` — ${v.reason}` : ""}</p>
          )}
        </GlassPanel>
        <div className="space-y-5">
          <GlassPanel className="space-y-2 p-5"><h2 className="display text-lg">History</h2><HistoryList items={v.history} /></GlassPanel>
          <GlassPanel className="space-y-2 p-5"><h2 className="display text-lg">Audit log</h2><AuditList items={v.log} /></GlassPanel>
        </div>
      </div>
    </div>
  );
}
