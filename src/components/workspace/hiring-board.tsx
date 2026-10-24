"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Columns3, ExternalLink, FileSearch, Square, Star, StarOff, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { HiringCandidate } from "@/types/workspace";
import { useDb } from "@/features/session";
import { getBrandCampaigns, setApplicationStatus, setShortlisted } from "@/services/campaigns";
import { getHiringBoard } from "@/services/workspace";
import { ContactButton } from "@/components/posts/actions";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Select } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { cn, compact, errorMessage, timeAgo } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { Countdown } from "./countdown";
import { HireButton } from "./hire-button";
import { canShortlist, SHORTLIST_LOCKED_HINT, ShortlistGate } from "@/components/campaign/shortlist-gate";
import { MediaThumb, useSignedPreviews } from "./media";
import { EscrowChip, ProjectStatusChip, SubmissionStatusChip } from "./status";

function CandidateCard({ c, campaign, urls, picked, onPick, onChanged }: {
  c: HiringCandidate;
  campaign: { id: string; currency: string; budget_min: number | null; status: string };
  urls: Record<string, string> | undefined;
  picked: boolean | null;
  onPick: () => void;
  onChanged: () => void;
}) {
  const db = useDb();
  const [busy, setBusy] = useState<string | null>(null);
  const p = c.project;
  const hired = !!p?.hired_at;
  const closed = p && ["rejected", "cancelled", "completed"].includes(p.status);
  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); onChanged(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <article className={cn("glass flex flex-col gap-3 rounded-[1.75rem] p-4", picked && "ring-2 ring-amber")}>
      <div className="flex items-start gap-3">
        {picked !== null && (
          <button type="button" onClick={onPick} aria-pressed={picked} aria-label={`Compare ${c.creator.display_name}`} className="mt-1">
            {picked ? <CheckSquare className="size-4 text-amber-ink" /> : <Square className="size-4 text-ink-3" />}
          </button>
        )}
        <Link href={`/u/${c.creator.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar src={c.creator.avatar_url} name={c.creator.display_name} size="md" verified={c.creator.is_verified} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{c.creator.display_name}</span>
            <span className="block truncate text-xs text-ink-2">{c.creator.headline}</span>
          </span>
        </Link>
        {p ? <ProjectStatusChip status={p.status} /> : c.shortlisted ? <Chip tone="amber" icon={<Star />}>Shortlisted</Chip> : null}
      </div>

      {c.application && (
        <div className="rounded-2xl bg-card/70 p-3 text-sm">
          <p className="line-clamp-3 whitespace-pre-line">{c.application.pitch}</p>
          <p className="mt-1 text-[11px] text-ink-3">
            Applied {timeAgo(c.application.created_at)}{c.application.proposed_rate != null && ` · proposes ${formatMoney(c.application.proposed_rate, campaign.currency)}`}
            {c.application.status === "rejected" && " · declined"}
          </p>
        </div>
      )}

      {c.latest_work ? (
        <Link href={`/brand/campaigns/review?submission=${c.latest_work.submission_id}`} className="flex items-center gap-2 rounded-2xl bg-card/70 p-2 hover:bg-card">
          <div className="flex gap-1.5">
            {c.latest_work.files.slice(0, 3).map((f, i) => <MediaThumb key={i} mediaType={f.media_type} path={f.thumbnail_path} urls={urls} className="size-14" />)}
          </div>
          <span className="min-w-0 flex-1 text-xs">
            <span className="block font-medium">Latest work · v{c.latest_work.version}</span>
            <SubmissionStatusChip status={c.latest_work.status} className="mt-1 px-2 py-0.5 text-[10px]" />
          </span>
          <span className="text-right">
            <span className="display block text-lg tabular-nums">{c.latest_work.ai_score ?? "—"}</span>
            <span className="text-[10px] text-ink-3">brand match</span>
          </span>
        </Link>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {c.creator.tools.slice(0, 4).map((t) => <Chip key={t.id} tone="outline">{t.name}</Chip>)}
          <span className="text-[11px] text-ink-3">{compact(c.creator.followers_count)} followers · {c.creator.posts_count} posts</span>
        </div>
      )}

      {p?.escrow && <div className="flex items-center gap-2 text-xs"><EscrowChip status={p.escrow.status} /><span className="tabular-nums">{formatMoney(p.escrow.amount, p.escrow.currency)}</span></div>}

      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line pt-3">
        {/* Hire opens the negotiation chat; the hire happens when the brand accepts the final proposal there */}
        {!hired && !closed && <HireButton campaignId={campaign.id} creatorId={c.creator.id} />}
        {hired && <Link href={`/brand/campaigns/projects/${p!.id}`} className={buttonVariants({ size: "sm", variant: "dark" })}><ExternalLink /> Project</Link>}
        {!hired && (
          <Button size="sm" variant="secondary" loading={busy === "s"} onClick={() => run("s", () => setShortlisted(db, campaign.id, c.creator.id, !c.shortlisted), c.shortlisted ? "Removed from shortlist" : "Shortlisted")}
            disabled={!c.shortlisted && !canShortlist(campaign.status)} title={!c.shortlisted && !canShortlist(campaign.status) ? SHORTLIST_LOCKED_HINT : undefined}>
            {c.shortlisted ? <StarOff /> : <Star />} {c.shortlisted ? "Unshortlist" : "Shortlist"}
          </Button>
        )}
        {c.application?.status === "pending" && !hired && (
          <Button size="sm" variant="ghost" loading={busy === "r"} onClick={() => run("r", () => setApplicationStatus(db, c.application!.id, "rejected"), "Candidate declined")}><X /> Reject</Button>
        )}
        <ContactButton profileId={c.creator.id} size="sm" label="Message" />
      </div>
    </article>
  );
}

function CompareCreators({ items, open, onOpenChange, urls, currency }: { items: HiringCandidate[]; open: boolean; onOpenChange: (o: boolean) => void; urls: Record<string, string> | undefined; currency: string }) {
  const rows: [string, (c: HiringCandidate) => React.ReactNode][] = [
    ["Experience", (c) => c.creator.experience_level ?? "—"],
    ["Availability", (c) => c.creator.availability ?? "—"],
    ["Followers", (c) => compact(c.creator.followers_count)],
    ["Verified items", (c) => c.creator.verified_count],
    ["Proposed fee", (c) => (c.application?.proposed_rate != null ? formatMoney(c.application.proposed_rate, currency) : "—")],
    ["Tools", (c) => c.creator.tools.slice(0, 5).map((t) => t.name).join(", ") || "—"],
    ["Latest work", (c) => (c.latest_work ? <div className="flex gap-1">{c.latest_work.files.slice(0, 2).map((f, i) => <MediaThumb key={i} mediaType={f.media_type} path={f.thumbnail_path} urls={urls} className="size-16" />)}</div> : "No submission")],
    ["Brand match", (c) => c.latest_work?.ai_score ?? "—"],
    ["Status", (c) => (c.project ? <ProjectStatusChip status={c.project.status} /> : c.shortlisted ? "Shortlisted" : "Applied")],
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Compare creators" size="xl">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr>
              <th className="w-32" />
              {items.map((c) => (
                <th key={c.creator.id} className="p-2 align-bottom">
                  <span className="flex items-center gap-2"><Avatar src={c.creator.avatar_url} name={c.creator.display_name} size="sm" /><span className="truncate">{c.creator.display_name}</span></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label} className="border-t border-line">
                <th scope="row" className="p-2 text-xs font-medium text-ink-3">{label}</th>
                {items.map((c) => <td key={c.creator.id} className="p-2 align-top capitalize">{fn(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

export function HiringBoard({ campaignId, onCampaign }: { campaignId: string | null; onCampaign: (id: string) => void }) {
  const db = useDb();
  const qc = useQueryClient();
  const campaigns = useQuery({ queryKey: ["campaigns", "all"], queryFn: () => getBrandCampaigns(db, {}) });
  const list = campaigns.data?.items.filter((c) => c.status !== "completed") ?? [];
  // Default to a live campaign that actually has people in its pipeline
  const busy = (c: (typeof list)[number]) => (c.stats?.applications ?? 0) + (c.stats?.shortlisted ?? 0) + (c.stats?.selected ?? 0);
  const current = list.find((c) => c.id === campaignId)
    ?? [...list].filter((c) => c.status === "active").sort((a, b) => busy(b) - busy(a))[0]
    ?? list[0];
  const board = useQuery({ queryKey: ["hiring", "board", current?.id], queryFn: () => getHiringBoard(db, current!.id), enabled: !!current });
  const urls = useSignedPreviews((board.data ?? []).flatMap((c) => c.latest_work?.files.map((f) => f.thumbnail_path ?? "") ?? []).filter(Boolean));
  const [pick, setPick] = useState<string[] | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const refresh = () => ["hiring", "pipeline", "campaign", "brand-overview", "deliveries"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  if (campaigns.isPending) return <Skeleton className="h-64 rounded-[1.75rem]" />;
  if (!current) return <EmptyState icon={<Users />} title="No open campaigns" description="Create a campaign or a sprint first — candidates appear here as they apply." action={<Link href="/brand/campaigns/studio" className={buttonVariants({ variant: "primary" })}>Create campaign</Link>} />;

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-3 rounded-[1.75rem] p-3">
        <Select aria-label="Campaign" value={current.id} onChange={(e) => onCampaign(e.target.value)} className="h-10 max-w-md flex-1">
          {list.map((c) => <option key={c.id} value={c.id}>{c.is_sprint ? "⚡ Sprint · " : ""}{c.title}{c.status === "draft" ? " (draft)" : ""}</option>)}
        </Select>
        {current.is_sprint && current.sprint_deadline && <Countdown to={current.sprint_deadline} compact />}
        <Link href={`/brand/campaigns/review?campaign=${current.id}`} className={buttonVariants({ size: "sm", variant: "secondary" })}><FileSearch /> Review work</Link>
        {pick ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setPick(null)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={pick.length < 2} onClick={() => setCompareOpen(true)}><Columns3 /> Compare {pick.length}/3</Button>
          </div>
        ) : <Button size="sm" variant="ghost" onClick={() => setPick([])}><Columns3 /> Compare creators</Button>}
      </div>

      <ShortlistGate campaign={current} onPublished={() => { refresh(); board.refetch(); }} />
      {board.isPending && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-[1.75rem]" />)}</div>}
      {board.isError && <ErrorState error={board.error} onRetry={() => board.refetch()} />}
      {board.isSuccess && board.data.length === 0 && (
        <EmptyState icon={<Users />} title="No candidates yet"
          description={current.status === "draft" ? "Publish this brief so creators can apply." : "Applicants, shortlisted and hired creators appear here. Find more in Ranked matches."}
          action={<Link href={`/campaigns/${current.id}`} className={buttonVariants({ variant: "primary" })}>Ranked matches</Link>} />
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {board.data?.map((c) => (
          <CandidateCard key={c.creator.id} c={c} campaign={current} urls={urls.data} onChanged={() => { refresh(); board.refetch(); }}
            picked={pick ? pick.includes(c.creator.id) : null}
            onPick={() => setPick((x) => (x?.includes(c.creator.id) ? x.filter((y) => y !== c.creator.id) : [...(x ?? []), c.creator.id].slice(-3)))} />
        ))}
      </div>
      {pick && <CompareCreators open={compareOpen} onOpenChange={setCompareOpen} items={(board.data ?? []).filter((c) => pick.includes(c.creator.id))} urls={urls.data} currency={current.currency} />}
    </div>
  );
}
