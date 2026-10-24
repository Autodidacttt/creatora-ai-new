"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
import type { CampaignStatus } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { getBrandCampaigns } from "@/services/campaigns";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { CollaboratorsBar } from "@/components/workspace/collaborators";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { PillCTA } from "@/components/ui/pill-cta";
import { buttonVariants } from "@/components/ui/button";
import { useEffect } from "react";
import { BrandDashboard } from "@/components/workspace/brand-dashboard";

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
  const count = (s: CampaignStatus) => all.data ? all.data.items.filter((c) => c.status === s).length : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Campaigns</p>
          <h1 className="display text-3xl sm:text-4xl">{me.role === "brand" ? "Brand dashboard" : "Your briefs"}</h1>
        </div>
        {me.role === "brand" && (
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/campaigns/new" className={buttonVariants({ variant: "ghost", size: "sm" })}>Quick brief form</Link>
            <PillCTA href="/brand/campaigns/studio">Create campaign</PillCTA>
          </div>
        )}
      </div>

      {me.role === "brand" && <BrandDashboard />}
      {me.role === "brand" && <h2 className="display pt-2 text-xl">Your briefs</h2>}

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
          description={me.role === "brand" ? "Describe your idea in one sentence and the AI brief builder will structure it — formats, tools, rights and all."
            : "Only brands create briefs. Campaign moderation lives in the Admin area."}
          action={me.role === "brand" && <Link href="/brand/campaigns/studio" className={buttonVariants({ variant: "primary" })}><Plus /> Create a campaign</Link>} />
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.items.map((c) => <CampaignCard key={c.id} campaign={c} showBrand={false} showStats footer={<CollaboratorsBar campaign={c} />} />)}
      </div>
    </div>
  );
}
