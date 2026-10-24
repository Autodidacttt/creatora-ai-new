"use client";

import Link from "next/link";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, FileSignature, Inbox, ListChecks, MessagesSquare, Plus, Sparkles, Star, StarOff, UserCheck, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { CampaignCard, CreatorCard } from "@/types/app";
import { useDb } from "@/features/session";
import { rankForCampaign, scoreCreators } from "@/services/discovery";
import { getApplications, getPipeline, setApplicationStatus, setSelected, setShortlisted } from "@/services/campaigns";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { ContactButton } from "@/components/posts/actions";
import { CreatorResultCard } from "@/components/discovery/creator-card";
import { errorMessage, money, timeAgo } from "@/lib/utils";
import { ScoreBreakdown, ScoreRing } from "./score-breakdown";
import { useStartNegotiation } from "@/components/workspace/hire-button";
import { canShortlist, SHORTLIST_LOCKED_HINT, ShortlistGate } from "./shortlist-gate";

const PROPOSAL_LABEL: Record<string, string> = {
  draft: "Proposal draft", sent: "Proposal sent", accepted: "Terms agreed", rejected: "Proposal declined", superseded: "Agreement replaced",
};

function usePipelineActions(campaign: CampaignCard) {
  const campaignId = campaign.id;
  const db = useDb();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const negotiation = useStartNegotiation();
  const refresh = () => {
    ["applications", "pipeline", "campaign", "matches", "hiring", "deliveries"].forEach((k) => qc.invalidateQueries({ queryKey: [k, campaignId] }));
  };
  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return {
    busy: busy ?? (negotiation.busy ? `x-${negotiation.busy}` : null),
    canShortlist: canShortlist(campaign.status),
    shortlist: (creator: CreatorCard, on: boolean) =>
      run(`s-${creator.id}`, () => setShortlisted(db, campaignId, creator.id, on), on ? `${creator.display_name} shortlisted` : "Removed from shortlist"),
    /** Hire opens the negotiation chat (nothing is hired until the brand accepts a final proposal); undoing a hire only works before any work or payment. */
    select: (creator: CreatorCard, on: boolean) =>
      on ? negotiation.start(campaignId, creator.id)
        : run(`x-${creator.id}`, () => setSelected(db, campaignId, creator.id, false), "Hire undone"),
    reject: (appId: string, on: boolean) =>
      run(`r-${appId}`, () => setApplicationStatus(db, appId, on ? "rejected" : "pending"), on ? "Application declined" : "Application restored"),
    dialog: <ShortlistGate campaign={campaign} onPublished={refresh} />,
  };
}

// ---------------------------------------------------------------------------
// Ranked matches with "Why this creator?"
// ---------------------------------------------------------------------------
export function MatchesTab({ campaign }: { campaign: CampaignCard }) {
  const db = useDb();
  const actions = usePipelineActions(campaign);
  const pipeline = useQuery({ queryKey: ["pipeline", campaign.id], queryFn: () => getPipeline(db, campaign.id) });
  const q = useInfiniteQuery({
    queryKey: ["matches", campaign.id],
    queryFn: ({ pageParam }) => rankForCampaign(db, campaign.id, pageParam, 9),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const stage = (id: string) => pipeline.data?.filter((p) => p.creator.id === id).map((p) => p.stage) ?? [];

  if (q.isPending) return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[30rem] rounded-[2rem]" />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const items = q.data.pages.flatMap((p) => p.items);
  if (!items.length) return <EmptyState icon={<Users />} title="No creators to rank yet" description="As creators join and fill in their profiles, they'll be ranked against this brief." />;

  return (
    <div className="space-y-4">
      {actions.dialog}
      <p className="flex items-start gap-2 rounded-2xl bg-amber-soft/70 px-4 py-3 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0" />
        <span>
          Ranked by <strong>relevance to this brief</strong> — a transparent weighted score of tools (25), portfolio relevance (25), skills (20),
          campaign experience (10), platform & audience fit (10) and availability (10). It&apos;s a matching signal, not a measure of talent.
        </span>
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((m) => {
          const s = stage(m.creator.id);
          const shortlisted = s.includes("shortlisted");
          const selected = s.includes("selected") || s.includes("completed");
          return (
            <CreatorResultCard
              key={m.creator.id}
              creator={m.creator}
              score={m.score}
              reasons={m.reasons}
              highlightTools={campaign.tools.map((t) => t.id)}
              compactActions
              footer={
                <div className="space-y-3">
                  <details className="group rounded-2xl bg-card px-3 py-2">
                    <summary className="cursor-pointer list-none text-xs font-medium text-ink-2 group-open:mb-2">Score breakdown ▾</summary>
                    <ScoreBreakdown breakdown={m.breakdown} />
                  </details>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant={shortlisted ? "secondary" : "primary"} loading={actions.busy === `s-${m.creator.id}`} onClick={() => actions.shortlist(m.creator, !shortlisted)}
                      disabled={!shortlisted && !actions.canShortlist} title={!shortlisted && !actions.canShortlist ? SHORTLIST_LOCKED_HINT : undefined}>
                      {shortlisted ? <StarOff /> : <Star />} {shortlisted ? "Shortlisted" : "Shortlist"}
                    </Button>
                    <Button size="sm" variant={selected ? "dark" : "secondary"} loading={actions.busy === `x-${m.creator.id}`} onClick={() => actions.select(m.creator, !selected)}>
                      <UserCheck /> {selected ? "Hired" : "Hire"}
                    </Button>
                    <ContactButton profileId={m.creator.id} size="sm" label="Contact" />
                  </div>
                </div>
              }
            />
          );
        })}
      </div>
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------
export function ApplicationsTab({ campaign }: { campaign: CampaignCard }) {
  const db = useDb();
  const actions = usePipelineActions(campaign);
  const apps = useQuery({ queryKey: ["applications", campaign.id], queryFn: () => getApplications(db, campaign.id) });
  const ids = apps.data?.map((a) => a.creator.id) ?? [];
  const scores = useQuery({
    queryKey: ["applications", campaign.id, "scores", ids],
    queryFn: () => scoreCreators(db, campaign.id, ids),
    enabled: ids.length > 0,
  });

  if (apps.isPending) return <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-[2rem]" />)}</div>;
  if (apps.isError) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />;
  if (!apps.data.length) {
    return (
      <EmptyState icon={<Inbox />} title="No applications yet"
        description={campaign.status === "draft" ? "Publish this brief so creators can find and apply to it." : "Creators who match this brief see it in their Opportunities. Meanwhile, reach out to your top matches."} />
    );
  }
  const sorted = [...apps.data].sort((a, b) => (scores.data?.get(b.creator.id)?.score ?? 0) - (scores.data?.get(a.creator.id)?.score ?? 0));

  return (
    <>
    {actions.dialog}
    <ul className="space-y-3">
      {sorted.map((a) => {
        const sc = scores.data?.get(a.creator.id);
        return (
          <li key={a.id} className="glass rounded-[2rem] p-5">
            <div className="flex flex-wrap items-start gap-4">
              <Link href={`/u/${a.creator.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar src={a.creator.avatar_url} name={a.creator.display_name} size="lg" verified={a.creator.is_verified} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{a.creator.display_name}</span>
                  <span className="block truncate text-sm text-ink-2">{a.creator.headline}</span>
                  <span className="text-xs text-ink-3">Applied {timeAgo(a.created_at)}{a.proposed_rate != null && ` · proposes ${money(a.proposed_rate, null, campaign.currency).replace("from ", "")}`}</span>
                </span>
              </Link>
              {sc && <ScoreRing score={sc.score} />}
            </div>
            <p className="mt-4 whitespace-pre-line rounded-2xl bg-card p-4 text-sm leading-relaxed">{a.pitch}</p>
            {sc && sc.reasons.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">{sc.reasons.slice(0, 4).map((r) => <Chip key={r} tone="amber">{r}</Chip>)}</div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {a.status === "rejected" && <Chip tone="danger">Declined</Chip>}
              {a.selected && <Chip tone="dark" icon={<Check />}>Hired</Chip>}
              {a.shortlisted && !a.selected && <Chip tone="amber" icon={<Star />}>Shortlisted</Chip>}
              {a.proposal && !a.selected && (
                <Chip tone={a.proposal.status === "sent" ? "amber" : a.proposal.status === "rejected" ? "danger" : "neutral"} icon={<FileSignature />}>
                  {PROPOSAL_LABEL[a.proposal.status] ?? a.proposal.status} · v{a.proposal.version} · {money(a.proposal.price, null, a.proposal.currency).replace("from ", "")}
                </Chip>
              )}
              {!a.proposal && a.conversation_id && !a.selected && <Chip tone="outline" icon={<MessagesSquare />}>Negotiating</Chip>}
              <span className="flex-1" />
              <Button size="sm" variant={a.shortlisted ? "secondary" : "primary"} loading={actions.busy === `s-${a.creator.id}`} onClick={() => actions.shortlist(a.creator, !a.shortlisted)}
                disabled={!a.shortlisted && !actions.canShortlist} title={!a.shortlisted && !actions.canShortlist ? SHORTLIST_LOCKED_HINT : undefined}>
                {a.shortlisted ? <StarOff /> : <Star />} {a.shortlisted ? "Unshortlist" : "Shortlist"}
              </Button>
              <Button size="sm" variant={a.selected ? "dark" : "secondary"} loading={actions.busy === `x-${a.creator.id}`} onClick={() => actions.select(a.creator, !a.selected)}>
                <UserCheck /> {a.selected ? "Hired" : "Hire"}
              </Button>
              {a.conversation_id
                ? <Link href={`/inbox/${a.conversation_id}`} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium hover:bg-ink/5"><MessagesSquare className="size-3.5" /> Negotiation</Link>
                : <ContactButton profileId={a.creator.id} size="sm" label="Message" />}
              <Button size="sm" variant="ghost" loading={actions.busy === `r-${a.id}`} onClick={() => actions.reject(a.id, a.status !== "rejected")}>
                <X /> {a.status === "rejected" ? "Restore" : "Decline"}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shortlist & selected
// ---------------------------------------------------------------------------
export function PipelineTab({ campaign }: { campaign: CampaignCard }) {
  const db = useDb();
  const actions = usePipelineActions(campaign);
  const q = useQuery({ queryKey: ["pipeline", campaign.id], queryFn: () => getPipeline(db, campaign.id) });
  if (q.isPending) return <Skeleton className="h-60 rounded-[2rem]" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const shortlisted = q.data.filter((p) => p.stage === "shortlisted");
  const selected = q.data.filter((p) => p.stage !== "shortlisted");
  if (!q.data.length) {
    return <EmptyState icon={<ListChecks />} title="Your shortlist is empty" description="Shortlist creators from Matches, Applications or Swipe — they'll be notified." />;
  }
  const column = (title: string, list: typeof q.data, kind: "shortlisted" | "selected") => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="display text-lg">{title} <span className="text-sm font-normal text-ink-3">
          {kind === "selected" ? `${list.filter((p) => p.stage !== "awaiting_funding").length} of ${campaign.creators_needed} hired` : list.length}
        </span></h3>
        {/* The creator count is a target, not a cap: brands can always hire more */}
        {kind === "selected" && (
          <Link href={`/campaigns/${campaign.id}?tab=matches`} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-card px-3 text-xs font-medium shadow-sm hover:bg-card/70">
            <Plus className="size-3.5" /> Add more creators
          </Link>
        )}
      </div>
      {list.length === 0 && <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-3">Nobody yet</p>}
      {list.map((p) => (
        <div key={`${p.stage}-${p.creator.id}`} className="glass flex flex-wrap items-center gap-3 rounded-[1.5rem] p-3">
          <Link href={`/u/${p.creator.username}`} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar src={p.creator.avatar_url} name={p.creator.display_name} verified={p.creator.is_verified} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{p.creator.display_name}</span>
              <span className="block truncate text-xs text-ink-3">{p.applied ? "Applied" : "Added from discovery"} · {timeAgo(p.created_at)}{p.stage === "completed" && " · completed"}</span>
              {p.stage === "awaiting_funding" && <span className="mt-0.5 block text-[11px] font-medium text-amber-ink">Hired · awaiting funding — not counted until funded</span>}
              {p.added_while_draft && <span className="mt-0.5 block text-[11px] text-amber-ink" title="Added before the brief was published. It stays, but new shortlists need a published brief.">Shortlisted while the brief was a draft</span>}
            </span>
          </Link>
          <div className="flex gap-1.5">
            {kind === "shortlisted" && (
              <Button size="sm" variant="primary" loading={actions.busy === `x-${p.creator.id}`} onClick={() => actions.select(p.creator, true)}><UserCheck /> Hire</Button>
            )}
            <ContactButton profileId={p.creator.id} size="sm" label="Message" />
            <Button size="icon-sm" variant="ghost" aria-label="Remove"
              onClick={() => (kind === "shortlisted" ? actions.shortlist(p.creator, false) : actions.select(p.creator, false))}><X /></Button>
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      {actions.dialog}
      <div className="grid gap-6 lg:grid-cols-2">
        {column("Shortlisted", shortlisted, "shortlisted")}
        {column("Hired", selected, "selected")}
      </div>
    </div>
  );
}
