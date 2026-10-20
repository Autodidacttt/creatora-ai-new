"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useDb, useMe } from "@/features/session";
import { getCampaign } from "@/services/campaigns";
import { CampaignForm } from "@/components/campaign/campaign-form";
import { ErrorState, Skeleton } from "@/components/ui/states";

export default function EditCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const db = useDb();
  const me = useMe();
  const c = useQuery({ queryKey: ["campaign", id], queryFn: () => getCampaign(db, id) });
  if (c.isPending) return <Skeleton className="h-[50rem] rounded-[2rem]" />;
  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data || c.data.brand_id !== me.id) return <ErrorState error="Only the brand that owns this brief can edit it." title="Not allowed" />;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="display text-3xl">Edit brief</h1>
      <CampaignForm campaign={c.data} />
    </div>
  );
}
