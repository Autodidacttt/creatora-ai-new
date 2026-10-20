"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft, Truck } from "lucide-react";
import { useDb } from "@/features/session";
import { getDeliveries } from "@/services/workspace";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { SprintsPanel } from "@/components/workspace/sprints-panel";
import { HiringBoard } from "@/components/workspace/hiring-board";
import { ProjectCard } from "@/components/workspace/project-card";

type Tab = "sprints" | "hiring" | "delivery";

function Delivery() {
  const db = useDb();
  const [filter, setFilter] = useState<"active" | "completed" | "closed">("active");
  const q = useInfiniteQuery({
    queryKey: ["deliveries", filter],
    queryFn: ({ pageParam }) => getDeliveries(db, filter, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-4">
      <SegmentedTabs size="sm" value={filter} onChange={setFilter}
        items={[{ value: "active", label: "In progress" }, { value: "completed", label: "Completed" }, { value: "closed", label: "Closed" }]} />
      {q.isPending && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-[1.75rem]" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState icon={<Truck />} title={filter === "active" ? "Nothing in delivery" : "Nothing here yet"}
          description={filter === "active" ? "Hired creators show up here — track their versions, fund escrow and release payment when you approve." : undefined} />
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => <ProjectCard key={p.id} p={p} view="brand" href={`/brand/campaigns/projects/${p.id}`} />)}
      </div>
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </div>
  );
}

export default function HiringPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) || "sprints";
  const campaign = params.get("campaign");
  const go = (t: Tab, extra = "") => router.replace(`/brand/campaigns/hiring?tab=${t}${extra}`, { scroll: false });

  return (
    <div className="space-y-5">
      <div>
        <Link href="/campaigns" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Campaigns</Link>
        <p className="eyebrow">Creator Hiring &amp; Delivery</p>
        <h1 className="display text-3xl sm:text-4xl">Hire, pay and deliver</h1>
        <p className="mt-1 text-sm text-ink-2">Escrow runs in test mode — an internal ledger where no real money moves.</p>
      </div>
      <SegmentedTabs value={tab} onChange={(t) => go(t)}
        items={[{ value: "sprints", label: "Sprints" }, { value: "hiring", label: "Hiring" }, { value: "delivery", label: "Active delivery" }]} />
      {tab === "sprints" && <SprintsPanel onOpenCandidates={(id) => go("hiring", `&campaign=${id}`)} />}
      {tab === "hiring" && <HiringBoard campaignId={campaign} onCampaign={(id) => go("hiring", `&campaign=${id}`)} />}
      {tab === "delivery" && <Delivery />}
    </div>
  );
}
