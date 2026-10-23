"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BadgeCheck, MessageSquare, RotateCcw, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { SubmissionStatus } from "@/types/workspace";
import { useDb } from "@/features/session";
import { getSubmissionDetail, reviewSubmission } from "@/services/workspace";
import { reviewDecisionSchema } from "@/lib/validation/workspace";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { cn, errorMessage, timeAgo } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { AiReviewPanel } from "./ai-review-panel";
import { Countdown } from "./countdown";
import { HireButton } from "./hire-button";
import { MediaThumb, PreviewViewer, previewPaths, useSignedPreviews } from "./media";
import { SubmissionStatusChip } from "./status";
import { CommentThread } from "./version-card";

type Decision = "approved" | "revision_requested" | "rejected";

/** The review workspace for one submission: viewer, versions, creator notes, AI cards, decision + comments. */
export function ReviewWorkspace({ id, onBack, onDecided }: { id: string; onBack?: () => void; onDecided: (id: string, status: SubmissionStatus) => void }) {
  const db = useDb();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["submission", id],
    queryFn: () => getSubmissionDetail(db, id),
    refetchInterval: (query) => (["pending", "running"].includes(query.state.data?.ai?.status ?? "") ? 4000 : false),
  });
  const s = q.data;
  const urls = useSignedPreviews(s?.files.flatMap(previewPaths) ?? []);
  const [active, setActive] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const [mode, setMode] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  if (q.isPending) return <div className="space-y-3"><Skeleton className="h-16 rounded-[1.75rem]" /><Skeleton className="aspect-video rounded-[1.75rem]" /><Skeleton className="h-40 rounded-[1.75rem]" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!s) return <EmptyState title="Submission not found" description="It may have been removed, or it belongs to another brand." />;

  const file = s.files[active] ?? s.files[0];
  const latest = s.versions[0]?.id === s.id;
  const canDecide = s.status === "submitted" && latest;
  const hired = !!s.project.hired_at;

  async function decide(decision: Decision) {
    const parsed = reviewDecisionSchema.safeParse({ decision, feedback });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Add feedback");
    setBusy(true);
    try {
      await reviewSubmission(db, id, decision, parsed.data.feedback);
      toast.success(decision === "approved" ? "Approved — fund and release payment to complete" : decision === "revision_requested" ? "Revision requested — the creator has been notified" : "Submission rejected");
      onDecided(id, decision);
      setMode(null);
      setFeedback("");
      ["review-inbox", "brand-overview", "project", "deliveries", "hiring"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      q.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="glass flex flex-wrap items-center gap-3 rounded-[1.75rem] p-4">
        {onBack && <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="Back to inbox" className="lg:hidden"><ArrowLeft /></Button>}
        <Avatar src={s.creator.avatar_url} name={s.creator.display_name} size="md" verified={s.creator.is_verified} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{s.creator.display_name} · <Link href={`/campaigns/${s.campaign.id}`} className="font-normal text-ink-2 hover:underline">{s.campaign.title}</Link></p>
          <p className="text-xs text-ink-3">Submitted {s.submitted_at ? timeAgo(s.submitted_at) : "—"} · {s.files.length} file{s.files.length === 1 ? "" : "s"}</p>
        </div>
        {s.campaign.is_sprint && s.campaign.sprint_deadline && <Countdown to={s.campaign.sprint_deadline} compact />}
        <SubmissionStatusChip status={s.status} />
        {s.versions.length > 1 && (
          <div className="flex gap-1" role="tablist" aria-label="Versions">
            {s.versions.map((v) => (
              <Link key={v.id} href={`/brand/campaigns/review?submission=${v.id}`} role="tab" aria-selected={v.id === s.id}
                className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", v.id === s.id ? "bg-ink text-bg" : "bg-ink/[0.06] hover:bg-ink/10")}>v{v.version}</Link>
            ))}
          </div>
        )}
      </header>

      <div className="glass space-y-3 rounded-[1.75rem] p-4">
        {file ? <PreviewViewer file={file} urls={urls.data} onTime={setMs} /> : <p className="text-sm text-ink-2">No files.</p>}
        {s.files.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {s.files.map((f, i) => (
              <button key={f.id} type="button" onClick={() => { setActive(i); setMs(null); }} aria-label={`Show file ${i + 1}`}
                className={i === active ? "rounded-xl ring-2 ring-amber" : "rounded-xl opacity-70 hover:opacity-100"}>
                <MediaThumb mediaType={f.media_type} path={f.thumbnail_path} urls={urls.data} className="size-14" />
              </button>
            ))}
          </div>
        )}
        {(s.notes || s.tools_used.length > 0 || s.workflow_notes) && (
          <div className="space-y-2 rounded-2xl bg-card/70 p-3.5 text-sm">
            {s.notes && <p className="whitespace-pre-line">{s.notes}</p>}
            {s.tools_used.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><Wrench className="size-3.5 text-ink-3" aria-label="Tools" />{s.tools_used.map((t) => <Chip key={t} tone="outline">{t}</Chip>)}</div>}
            {s.workflow_notes && <p className="whitespace-pre-line text-xs text-ink-2"><b>Workflow:</b> {s.workflow_notes}</p>}
          </div>
        )}
      </div>

      <AiReviewPanel submissionId={s.id} ai={s.ai} onRetry={() => q.refetch()} />

      {canDecide ? (
        <section className="glass space-y-3 rounded-[1.75rem] p-4" aria-label="Decision">
          {!hired && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-soft/70 p-3 text-sm">
              <span className="min-w-0 flex-1">This is sprint spec work. Agree the fee with {s.creator.display_name} in chat and accept their final proposal to hire, then approve.</span>
              <HireButton campaignId={s.campaign.id} creatorId={s.creator.id} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!hired} loading={busy && mode === "approved"} onClick={() => { setMode("approved"); decide("approved"); }}><BadgeCheck /> Approve</Button>
            <Button variant={mode === "revision_requested" ? "dark" : "secondary"} onClick={() => setMode(mode === "revision_requested" ? null : "revision_requested")}><RotateCcw /> Request revision</Button>
            <Button variant={mode === "rejected" ? "danger" : "ghost"} onClick={() => setMode(mode === "rejected" ? null : "rejected")}><XCircle /> Reject</Button>
          </div>
          {(mode === "revision_requested" || mode === "rejected") && (
            <div className="space-y-2">
              <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} autoFocus maxLength={4000} aria-label="Feedback for the creator"
                placeholder={mode === "revision_requested" ? "What should change? Be specific — this goes straight to the creator." : "Why is this being rejected?"} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-ink-3">Required. {file?.media_type === "video" ? "Add time-stamped notes in the comments below." : ""}</p>
                <Button variant={mode === "rejected" ? "danger" : "primary"} loading={busy} onClick={() => decide(mode)}>
                  {mode === "rejected" ? "Reject submission" : "Send revision request"}
                </Button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <div className="glass flex flex-wrap items-center gap-3 rounded-[1.75rem] p-4 text-sm">
          <span className="min-w-0 flex-1">
            {!latest ? "A newer version exists — review the latest one." : s.status === "approved" ? "Approved. Fund and release escrow to complete the project and issue the licence record." : s.status === "revision_requested" ? "Waiting for the creator's revision." : s.status === "rejected" ? "Rejected." : ""}
          </span>
          <Link href={`/brand/campaigns/projects/${s.project.id}`} className={buttonVariants({ size: "sm", variant: s.status === "approved" ? "primary" : "secondary" })}>
            {s.status === "approved" ? `Payment · ${formatMoney(s.project.agreed_amount, s.project.currency)}` : "Open project"}
          </Link>
        </div>
      )}

      <section className="glass rounded-[1.75rem] p-4" aria-label="Comments">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><MessageSquare className="size-4" /> Comments</p>
        <CommentThread submission={s} currentMs={file?.preview_kind === "video_ffmpeg" ? ms : null} fileId={file?.id ?? null} onAdded={() => q.refetch()} />
      </section>

    </div>
  );
}
