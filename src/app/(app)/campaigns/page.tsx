"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
import type { CampaignStatus } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { getBrandCampaigns, getDashboard } from "@/services/campaigns";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { StatBlob } from "@/components/ui/stat-blob";
import { PillCTA } from "@/components/ui/pill-cta";
import { buttonVariants } from "@/components/ui/button";
import { useEffect } from "react";

type Tab = "all" | CampaignStatus;

export default function CampaignsPage() {
  const me = useMe();
  const db = useDb();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("status") as Tab) || "all";

  useEffect(() => {
    if (me.role === "creator") router.replace("/opportunities");
  }, [me.role, router]);

  const list = useQuery({
    queryKey: ["campaigns", tab],
    queryFn: () => getBrandCampaigns(db, { status: tab === "all" ? null : tab }),
    enabled: me.role !== "creator",
  });
  const all = useQuery({ queryKey: ["campaigns", "all"], queryFn: () => getBrandCampaigns(db, {}), enabled: me.role !== "creator" });
  const dash = useQuery({ queryKey: ["dashboard", "brand"], queryFn: () => getDashboard(db, "brand"), enabled: me.role === "brand" });
  const count = (s: CampaignStatus) => all.data ? all.data.items.filter((c) => c.status === s).length : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Campaigns</p>
          <h1 className="display text-3xl sm:text-4xl">Your briefs</h1>
        </div>
        <PillCTA href="/campaigns/new">New brief</PillCTA>
      </div>

      {dash.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBlob value={dash.data.active ?? 0} label="Active briefs" accent />
          <StatBlob value={dash.data.applications ?? 0} label="Applications" />
          <StatBlob value={dash.data.shortlisted ?? 0} label="Shortlisted" />
          <StatBlob value={dash.data.selected ?? 0} label="Selected" />
        </div>
      )}

      <SegmentedTabs
        value={tab}
        onChange={(t) => router.replace(t === "all" ? "/campaigns" : `/campaigns?status=${t}`, { scroll: false })}
        items={[
          { value: "all", label: "All", count: all.data?.total },
          { value: "active", label: "Active", count: count("active") },
          { value: "draft", label: "Drafts", count: count("draft") },
          { value: "completed", label: "Completed", count: count("completed") },
        ]}
      />

      {list.isPending && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80 rounded-[2rem]" />)}</div>}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data?.items.length === 0 && (
        <EmptyState icon={<Megaphone />} title={tab === "all" ? "No briefs yet" : `No ${tab} briefs`}
          description="Describe your idea in one sentence and the AI brief builder will structure it — formats, tools, rights and all."
          action={<Link href="/campaigns/new" className={buttonVariants({ variant: "primary" })}><Plus /> Create a brief</Link>} />
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.items.map((c) => <CampaignCard key={c.id} campaign={c} showBrand={false} showStats />)}
      </div>
    </div>
  );
}
