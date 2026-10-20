"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Bookmark, BookmarkCheck, Briefcase, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { getDashboard, getOpportunities, ignoreOpportunity, setSavedOpportunity, type Opportunity } from "@/services/campaigns";
import { CampaignCard } from "@/components/campaign/campaign-card";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { StatBlob } from "@/components/ui/stat-blob";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { errorMessage } from "@/lib/utils";
import { MyProjects } from "@/components/workspace/my-projects";

type Tab = "for_you" | "saved" | "applied" | "projects";

function OpportunityActions({ o, onHidden }: { o: Opportunity; onHidden: () => void }) {
  const db = useDb();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(o.campaign.saved);
  const app = o.campaign.my_application;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {app ? (
        <Chip tone={app.status === "rejected" ? "danger" : "amber"} className="capitalize">
          {o.campaign.my_selected ? "Selected 🎉" : o.campaign.my_shortlisted ? "Shortlisted" : app.status === "pending" ? "Applied" : app.status}
        </Chip>
      ) : (
        <Link href={`/campaigns/${o.campaign.id}`} className={buttonVariants({ size: "sm", variant: "primary" })}>View & apply</Link>
      )}
      <Button size="sm" onClick={async () => {
        const next = !saved;
        setSaved(next);
        try {
          await setSavedOpportunity(db, o.campaign.id, next);
          qc.invalidateQueries({ queryKey: ["opportunities", "saved"] });
          toast.success(next ? "Saved for later" : "Removed from saved");
        } catch (e) { setSaved(!next); toast.error(errorMessage(e)); }
      }}>
        {saved ? <BookmarkCheck /> : <Bookmark />} {saved ? "Saved" : "Save"}
      </Button>
      {!app && (
        <Button size="sm" variant="ghost" onClick={async () => {
          try { await ignoreOpportunity(db, o.campaign.id); onHidden(); toast.success("Hidden — we'll show you fewer like this"); }
          catch (e) { toast.error(errorMessage(e)); }
        }}>
          <EyeOff /> Not for me
        </Button>
      )}
    </div>
  );
}

export default function OpportunitiesPage() {
  const me = useMe();
  const db = useDb();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) || "for_you";
  const [hidden, setHidden] = useState<string[]>([]);

  useEffect(() => {
    if (me.role === "brand") router.replace("/campaigns");
  }, [me.role, router]);

  const dash = useQuery({ queryKey: ["dashboard", "creator"], queryFn: () => getDashboard(db, "creator"), enabled: me.role === "creator" });
  const q = useInfiniteQuery({
    queryKey: ["opportunities", tab],
    queryFn: ({ pageParam }) => getOpportunities(db, tab === "projects" ? "for_you" : tab, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
    enabled: me.role !== "brand" && tab !== "projects",
  });
  const items = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((o) => !hidden.includes(o.campaign.id));

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Opportunities</p>
        <h1 className="display text-3xl sm:text-4xl">Briefs that fit your work</h1>
        <p className="mt-1 text-sm text-ink-2">Ranked by how well your tools, formats, styles and languages match each brief.</p>
      </div>

      {dash.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBlob value={dash.data.applications ?? 0} label="Applications sent" href="/opportunities?tab=applied" accent />
          <StatBlob value={dash.data.shortlisted ?? 0} label="Shortlisted" href="/opportunities?tab=applied" />
          <StatBlob value={dash.data.selected ?? 0} label="Hired" href="/opportunities?tab=projects" />
          <StatBlob value={dash.data.active_projects ?? 0} label={dash.data.revisions_requested ? `Active projects · ${dash.data.revisions_requested} need changes` : "Active projects"} href="/opportunities?tab=projects" />
        </div>
      )}

      <SegmentedTabs
        value={tab}
        onChange={(t) => router.replace(t === "for_you" ? "/opportunities" : `/opportunities?tab=${t}`, { scroll: false })}
        items={[{ value: "for_you", label: "For you" }, { value: "saved", label: "Saved" }, { value: "applied", label: "Applied" }, { value: "projects", label: "My projects", count: dash.data?.active_projects || undefined }]}
      />

      {tab === "projects" ? <MyProjects /> : (<>
      {q.isPending && <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-80 rounded-[2rem]" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<Briefcase />}
          title={tab === "saved" ? "No saved briefs" : tab === "applied" ? "You haven't applied yet" : "No open briefs right now"}
          description={tab === "for_you" ? "Add more tools, styles and content types to your profile to unlock more matches." : "Browse For you to find briefs that fit."}
          action={<Link href={tab === "for_you" ? "/settings/profile" : "/opportunities"} className={buttonVariants({ variant: "primary" })}>{tab === "for_you" ? "Improve my profile" : "See briefs for you"}</Link>}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <AnimatePresence>
          {items.map((o) => (
            <motion.div key={o.campaign.id} layout exit={{ opacity: 0, scale: 0.95 }}>
              <CampaignCard campaign={o.campaign} score={o.score} reasons={o.reasons}
                footer={<OpportunityActions o={o} onHidden={() => setHidden((h) => [...h, o.campaign.id])} />} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
      </>)}
    </div>
  );
}
