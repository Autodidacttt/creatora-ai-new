"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileSearch } from "lucide-react";
import type { InboxFilters } from "@/services/workspace";
import { ReviewInbox, type InboxStatus } from "@/components/workspace/review-inbox";
import { ReviewWorkspace } from "@/components/workspace/review-workspace";
import { CompareDialog } from "@/components/workspace/compare-dialog";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

export default function CreativeReviewPage() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const selected = params.get("submission");
  const filters = {
    status: (params.get("status") as InboxStatus) || "pending",
    campaignId: params.get("campaign"),
    creatorId: params.get("creator"),
  };
  const [compare, setCompare] = useState<string[] | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    Object.entries(next).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)));
    router.replace(`/brand/campaigns/review${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };
  const setFilters = (f: Partial<InboxFilters>) => go({
    ...(f.status !== undefined ? { status: f.status === "pending" ? null : f.status } : {}),
    ...(f.campaignId !== undefined ? { campaign: f.campaignId } : {}),
    ...(f.creatorId !== undefined ? { creator: f.creatorId } : {}),
  });

  return (
    <div className="space-y-5">
      <div>
        <Link href="/campaigns" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Campaigns</Link>
        <p className="eyebrow">Creative Review</p>
        <h1 className="display text-3xl sm:text-4xl">Review submitted work</h1>
        <p className="mt-1 text-sm text-ink-2">Watermarked previews only — originals unlock after you approve and fund escrow.</p>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className={cn("glass h-fit min-w-0 rounded-[1.75rem] p-3 lg:sticky lg:top-24", selected && "hidden lg:block")}>
          <ReviewInbox filters={filters} setFilters={setFilters} selected={selected} onSelect={(id) => go({ submission: id })}
            compare={compare} setCompare={setCompare} onCompare={() => setCompareOpen(true)} />
        </aside>
        <main className={cn("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <ReviewWorkspace key={selected} id={selected} onBack={() => go({ submission: null })}
              onDecided={() => qc.invalidateQueries({ queryKey: ["review-inbox"] })} />
          ) : (
            <EmptyState icon={<FileSearch />} title="Pick a submission" description="Select something from the inbox to see the preview, the AI checks and your decision options." />
          )}
        </main>
      </div>
      {compare && <CompareDialog ids={compare} open={compareOpen} onOpenChange={setCompareOpen} />}
    </div>
  );
}
