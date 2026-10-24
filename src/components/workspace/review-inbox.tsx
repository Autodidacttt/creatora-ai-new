"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CheckSquare, Columns3, Inbox, Square } from "lucide-react";
import type { ReviewInboxItem } from "@/types/workspace";
import { useDb } from "@/features/session";
import { getBrandCampaigns } from "@/services/campaigns";
import { getReviewInbox, type InboxFilters } from "@/services/workspace";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { cn, timeAgo } from "@/lib/utils";
import { MediaThumb, useSignedPreviews } from "./media";
import { SubmissionStatusChip } from "./status";

export type InboxStatus = NonNullable<InboxFilters["status"]>;

export function ReviewInbox({ filters, setFilters, selected, onSelect, compare, setCompare, onCompare }: {
  filters: Required<Pick<InboxFilters, "status">> & InboxFilters;
  setFilters: (f: Partial<InboxFilters>) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  compare: string[] | null;
  setCompare: (ids: string[] | null) => void;
  onCompare: () => void;
}) {
  const db = useDb();
  const campaigns = useQuery({ queryKey: ["campaigns", "all"], queryFn: () => getBrandCampaigns(db, {}) });
  const everyone = useQuery({ queryKey: ["review-inbox", "creators"], queryFn: () => getReviewInbox(db, { status: "all" }, 0, 50) });
  const q = useInfiniteQuery({
    queryKey: ["review-inbox", filters],
    queryFn: ({ pageParam }) => getReviewInbox(db, filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const items: ReviewInboxItem[] = q.data?.pages.flatMap((p) => p.items) ?? [];
  const thumbs = useSignedPreviews(items.map((i) => i.cover?.thumbnail_path ?? "").filter(Boolean));
  const creators = [...new Map((everyone.data?.items ?? []).map((i) => [i.creator.id, i.creator])).values()];
  const toggle = (id: string) => setCompare(compare?.includes(id) ? compare.filter((x) => x !== id) : [...(compare ?? []), id].slice(-3));

  return (
    <div className="space-y-3">
      <SegmentedTabs size="sm" value={filters.status} onChange={(status) => setFilters({ status })}
        items={[{ value: "pending", label: "Pending" }, { value: "revision_requested", label: "Changes" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }]} />
      <div className="grid grid-cols-2 gap-2">
        <Select aria-label="Filter by campaign" value={filters.campaignId ?? ""} onChange={(e) => setFilters({ campaignId: e.target.value || null })} className="h-9 text-xs">
          <option value="">All campaigns</option>
          {campaigns.data?.items.map((c) => <option key={c.id} value={c.id}>{c.is_sprint ? "⚡ " : ""}{c.title}</option>)}
        </Select>
        <Select aria-label="Filter by creator" value={filters.creatorId ?? ""} onChange={(e) => setFilters({ creatorId: e.target.value || null })} className="h-9 text-xs">
          <option value="">All creators</option>
          {creators.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-3">{q.data ? `${q.data.pages[0]?.total ?? 0} submission${q.data.pages[0]?.total === 1 ? "" : "s"}` : " "}</p>
        {compare ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setCompare(null)}>Cancel</Button>
            <Button size="sm" variant="primary" disabled={compare.length < 2} onClick={onCompare}><Columns3 /> Compare {compare.length}/3</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setCompare([])}><Columns3 /> Compare</Button>
        )}
      </div>

      {q.isPending && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState icon={<Inbox />} title={filters.status === "pending" ? "Nothing waiting for review" : "No submissions here"}
          description={filters.status === "pending" ? "When creators submit work, it lands here with a watermarked preview and AI checks." : undefined} className="py-8" />
      )}
      <ul className="space-y-2">
        {items.map((i) => {
          const picked = compare?.includes(i.id);
          return (
            <li key={i.id}>
              <button type="button" onClick={() => (compare ? toggle(i.id) : onSelect(i.id))} aria-pressed={compare ? picked : i.id === selected}
                className={cn("flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-colors",
                  i.id === selected && !compare ? "bg-card shadow-soft ring-1 ring-amber/50" : "hover:bg-card/70", !i.is_latest && "opacity-70")}>
                {compare && (picked ? <CheckSquare className="size-4 shrink-0 text-amber-ink" /> : <Square className="size-4 shrink-0 text-ink-3" />)}
                <MediaThumb mediaType={i.cover?.media_type} path={i.cover?.thumbnail_path} urls={thumbs.data} className="size-14" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <Avatar src={i.creator.avatar_url} name={i.creator.display_name} size="xs" />
                    <span className="truncate text-sm font-medium">{i.creator.display_name}</span>
                    <span className="text-[11px] text-ink-3">v{i.version}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-2">{i.campaign.is_sprint ? "⚡ " : ""}{i.campaign.title}</span>
                  <span className="mt-1 flex items-center gap-1.5">
                    <SubmissionStatusChip status={i.status} className="px-2 py-0.5 text-[10px]" />
                    <span className="text-[11px] text-ink-3">{i.submitted_at ? timeAgo(i.submitted_at) : ""}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right" aria-label={i.ai?.score != null ? `Brand match ${i.ai.score}` : "AI review pending"}>
                  {i.ai?.status === "done" || (i.ai?.status === "failed" && i.ai.score != null)
                    ? <span className="display text-lg tabular-nums">{i.ai.score ?? "—"}</span>
                    : <span className="text-[10px] text-ink-3">{i.ai?.status === "failed" ? "AI failed" : "Analysing…"}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </div>
  );
}
