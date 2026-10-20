"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { useDb } from "@/features/session";
import { listCampaigns } from "@/services/admin";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

export default function AdminCampaigns() {
  const db = useDb();
  const [status, setStatus] = useState<"all" | "draft" | "active" | "completed">("all");
  const q = useQuery({ queryKey: ["admin", "campaigns", status], queryFn: () => listCampaigns(db, status === "all" ? null : status) });
  return (
    <div className="space-y-5">
      <h1 className="display text-3xl">Campaigns</h1>
      <SegmentedTabs value={status} onChange={setStatus} items={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "completed", label: "Completed" }]} />
      {q.isPending && <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-72" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <EmptyState icon={<Megaphone />} title="No campaigns" />}
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((c) => <CampaignCard key={c.id} campaign={c} showStats />)}
      </div>
    </div>
  );
}
