"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CalendarClock, ClipboardList, FileSearch, History, Hourglass, ListTodo, Lock, Palette, Play, Star } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { cancelProject, getProject, leaveProjectReview, startProject } from "@/services/workspace";
import { projectReviewSchema } from "@/lib/validation/workspace";
import { BriefDetails } from "@/components/campaign/brief-details";
import { ContactButton } from "@/components/posts/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { errorMessage } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/money";
import { Countdown } from "./countdown";
import { ExpandableCard } from "./expandable";
import { GuidelineSummary } from "./guideline-summary";
import { useStartNegotiation } from "./hire-button";
import { CreatorTasks } from "./collaborators";
import { PaymentCard, ReasonDialog } from "./payment-card";
import { PROJECT_STATUS, ProjectStatusChip, ProjectStepper } from "./status";
import { SubmitWork } from "./submit-work";
import { Timeline } from "./timeline";
import { VersionCard } from "./version-card";

function ReviewForm({ projectId, subjectId, onDone }: { projectId: string; subjectId: string; onDone: () => void }) {
  const db = useDb();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const parsed = projectReviewSchema.safeParse({ rating, body });
      if (!parsed.success) return toast.error("Pick a rating from 1 to 5");
      setBusy(true);
      try { await leaveProjectReview(db, projectId, subjectId, parsed.data.rating, parsed.data.body); toast.success("Thanks for the review"); onDone(); }
      catch (err) { toast.error(errorMessage(err)); }
      finally { setBusy(false); }
    }}>
      <div className="flex gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)}>
            <Star className={n <= rating ? "size-6 fill-amber text-amber-ink" : "size-6 text-ink-3"} />
          </button>
        ))}
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="How was it working together?" maxLength={1500} className="min-h-16" aria-label="Review" />
      <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!rating}>Post review</Button>
    </form>
  );
}

/** A single project for either party: status, next step, versions, payment, timeline, brief and guidelines. */
export function ProjectView({ id }: { id: string }) {
  const db = useDb();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["project", id], queryFn: () => getProject(db, id), refetchInterval: 30_000 });
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const negotiation = useStartNegotiation();
  // "Fund project" opens straight after Hire (/brand/campaigns/projects/:id?fund=1)
  const [fundOpen, setFundOpen] = useState(useSearchParams().get("fund") === "1");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["project", id] });
    ["my-projects", "deliveries", "brand-overview", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-52 rounded-[2rem]" /><Skeleton className="h-96 rounded-[2rem]" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  if (!p) return <EmptyState title="Project not found" description="It may have been removed, or you don't have access to it." />;

  const isCreator = p.role === "creator";
  const other = isCreator ? p.campaign.brand : p.creator;
  const submitted = p.submissions.filter((s) => s.status !== "draft");
  const draft = p.submissions.find((s) => s.status === "draft") ?? null;
  const sprintOpen = p.campaign.is_sprint && !p.campaign.sprint_closed;
  const canSubmit = isCreator && (["hired", "in_progress", "revision_requested"].includes(p.status) || (sprintOpen && ["applied", "shortlisted"].includes(p.status)));
  const latest = submitted[0];
  const myReview = p.reviews.find((r) => r.author_id !== other.id);
  const back = isCreator ? { href: "/opportunities?tab=projects", label: "My projects" } : { href: "/brand/campaigns/hiring?tab=delivery", label: "Active delivery" };

  return (
    <div className="space-y-5">
      <section className="glass rounded-[2rem] p-5 sm:p-7">
        <Link href={back.href} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> {back.label}</Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <ProjectStatusChip status={p.status} />
              {p.campaign.is_sprint && <span className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-bg">48h sprint</span>}
              {p.campaign.is_sprint && p.campaign.sprint_deadline && <Countdown to={p.campaign.sprint_deadline} />}
            </div>
            <h1 className="display text-2xl sm:text-3xl">{p.campaign.title}</h1>
            <Link href={`/u/${other.username}`} className="mt-2 inline-flex items-center gap-2 text-sm">
              <Avatar src={other.avatar_url} name={other.display_name} size="xs" verified={other.is_verified} />
              <span className="font-medium">{other.company_name ?? other.display_name}</span>
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
            <dt className="text-xs text-ink-3">Agreed fee</dt><dd className="font-semibold tabular-nums">{formatMoney(p.agreed_amount, p.currency)}</dd>
            <dt className="text-xs text-ink-3">Due</dt><dd className="flex items-center gap-1 sm:justify-end"><CalendarClock className="size-3.5 text-ink-3" />{formatDate(p.campaign.sprint_deadline ?? p.campaign.deadline)}</dd>
            <dt className="text-xs text-ink-3">Payment</dt><dd>{p.payment_status === "paid" ? "Paid" : p.escrow?.status === "funded" ? "In escrow" : "Pending"}</dd>
          </dl>
        </div>
        {p.status === "awaiting_funding" && (
          <div role="status" className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber/50 bg-amber-soft/70 p-3.5 text-sm">
            <Hourglass className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {isCreator
                ? <><strong>Waiting for the brand to fund.</strong> You can start, submit work and receive tasks once the project is funded.</>
                : <><strong>Fund this project to start.</strong> {p.creator.display_name} can&apos;t start, submit or get tasks until it&apos;s funded (demo escrow, no real money).</>}
            </span>
            {!isCreator && p.escrow?.status === "unfunded" && <Button size="sm" variant="primary" onClick={() => setFundOpen(true)}><Lock /> Fund project</Button>}
            {!isCreator && <Button size="sm" variant="ghost" onClick={() => setCancelOpen(true)}><Ban /> Cancel hire</Button>}
          </div>
        )}
        <ProjectStepper status={p.status} hired={!!p.hired_at} className="mt-6" />
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-card/70 p-3.5">
          <p className="min-w-0 flex-1 text-sm">{PROJECT_STATUS[p.status][isCreator ? "creator" : "brand"]}</p>
          {isCreator && p.status === "hired" && (
            <Button variant="primary" loading={busy} onClick={async () => {
              setBusy(true);
              try { await startProject(db, p.id); toast.success("Marked as started — the brand can see you're on it"); refresh(); }
              catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
            }}><Play /> Start work</Button>
          )}
          {!isCreator && latest && latest.status === "submitted" && (
            <Link href={`/brand/campaigns/review?submission=${latest.id}`} className={buttonVariants({ variant: "primary" })}><FileSearch /> Review v{latest.version}</Link>
          )}
          <ContactButton profileId={other.id} size="sm" label={isCreator ? "Message brand" : "Message creator"} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          {canSubmit && <SubmitWork project={p} draft={draft} onChanged={refresh} onSubmitted={refresh} />}
          {submitted.length > 0 ? (
            <div className="space-y-3">
              <h2 className="display text-lg">Versions</h2>
              {submitted.map((s, i) => <VersionCard key={s.id} s={s} defaultOpen={i === 0} onChanged={refresh}
                canDownloadOriginals={!isCreator && s.status === "approved" && p.escrow?.status === "released"} />)}
            </div>
          ) : !canSubmit ? (
            <EmptyState icon={<ClipboardList />} title="No work submitted yet" description={isCreator ? undefined : "You'll be notified when the creator submits the first version."} />
          ) : null}
          <ExpandableCard icon={<ClipboardList />} title="Brief" subtitle="Everything the brand asked for">
            <BriefDetails campaign={p.campaign_card} />
          </ExpandableCard>
          {p.guideline && (
            <ExpandableCard icon={<Palette />} title="Brand guidelines" subtitle={`${p.guideline.name} · v${p.guideline.version}`}>
              <GuidelineSummary g={p.guideline} />
            </ExpandableCard>
          )}
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:h-fit">
          <PaymentCard project={p} payments={p.payments} role={p.role} onChanged={refresh} onSetAmount={() => negotiation.start(p.campaign_id, p.creator.id)}
            fundOpen={!isCreator && fundOpen} onFundOpenChange={setFundOpen} />
          {isCreator && p.hired_at && !["cancelled", "rejected"].includes(p.status) && (
            <ExpandableCard icon={<ListTodo />} title="Tasks" subtitle="From the brand — yours and the group's" defaultOpen>
              <CreatorTasks campaignId={p.campaign_id} />
            </ExpandableCard>
          )}
          <ExpandableCard icon={<History />} title="Timeline" subtitle={`${p.events.length} event${p.events.length === 1 ? "" : "s"}`} defaultOpen>
            <Timeline events={p.events} />
          </ExpandableCard>
          {p.status === "completed" && (
            <ExpandableCard icon={<Star />} title={`Review ${other.display_name}`} defaultOpen={!myReview}>
              {myReview ? <p className="text-sm">You rated {myReview.rating}/5{myReview.body ? ` — “${myReview.body}”` : ""}.</p>
                : <ReviewForm projectId={p.id} subjectId={other.id} onDone={refresh} />}
              {p.reviews.filter((r) => r.author_id === other.id).map((r) => (
                <p key={r.id} className="mt-3 rounded-xl bg-card/70 p-3 text-sm">{r.author.display_name} rated you {r.rating}/5{r.body ? ` — “${r.body}”` : ""}</p>
              ))}
            </ExpandableCard>
          )}
          {!isCreator && !["completed", "rejected", "cancelled", "approved"].includes(p.status) && p.hired_at && (
            <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}><Ban /> {p.status === "awaiting_funding" ? "Cancel hire" : "Cancel project"}</Button>
          )}
        </aside>
      </div>

      <ReasonDialog open={cancelOpen} onOpenChange={setCancelOpen} title={p.status === "awaiting_funding" ? "Cancel this hire?" : "Cancel this project?"}
        cta={p.status === "awaiting_funding" ? "Cancel hire" : "Cancel project"} danger
        description={p.status === "awaiting_funding"
          ? "The creator is notified. Nothing was paid, so there's nothing to refund."
          : "The creator is notified. Any funded escrow is refunded to you automatically (demo)."}
        onSubmit={async (reason) => { await cancelProject(db, p.id, reason); toast.success("Project cancelled"); refresh(); }} />
    </div>
  );
}
