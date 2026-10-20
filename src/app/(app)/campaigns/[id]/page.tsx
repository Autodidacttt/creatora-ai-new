"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Layers, MoreHorizontal, Pencil, RotateCcw, Rocket, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { deleteCampaign, getCampaign, setCampaignStatus } from "@/services/campaigns";
import { BriefDetails } from "@/components/campaign/brief-details";
import { ApplicationsTab, MatchesTab, PipelineTab } from "@/components/campaign/brand-campaign-tabs";
import { ApplyPanel } from "@/components/campaign/apply-panel";
import { DeadlineChip, StatusChip } from "@/components/campaign/campaign-card";
import { SegmentedTabs } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { errorMessage, money, timeAgo } from "@/lib/utils";

type Tab = "matches" | "applications" | "pipeline" | "brief";

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const db = useDb();
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["campaign", id], queryFn: () => getCampaign(db, id) });
  const tab = (params.get("tab") as Tab) || "matches";

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-48 rounded-[2rem]" /><Skeleton className="h-96 rounded-[2rem]" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) {
    return <EmptyState title="Brief not found" description="It may be a draft you don't have access to, or it was deleted."
      action={<Link href={me.role === "brand" ? "/campaigns" : "/opportunities"} className={buttonVariants({ variant: "primary" })}>Back</Link>} />;
  }
  const c = q.data;
  const isOwner = c.brand_id === me.id;

  async function changeStatus(status: "active" | "completed" | "draft") {
    setBusy(true);
    try {
      await setCampaignStatus(db, c.id, status);
      toast.success(status === "active" ? "Brief published" : status === "completed" ? "Marked as completed" : "Moved back to drafts");
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm("Delete this brief and all its applications? This can't be undone.")) return;
    try {
      await deleteCampaign(db, c.id);
      toast.success("Brief deleted");
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      router.push("/campaigns");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const header = (
    <section className="glass rounded-[2rem] p-5 sm:p-7">
      <Link href={isOwner ? "/campaigns" : "/opportunities"} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> {isOwner ? "All briefs" : "Opportunities"}</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusChip status={c.status} />
            <DeadlineChip deadline={c.deadline} />
            {c.ai_assisted && <Chip tone="amber" icon={<Sparkles />}>AI-structured brief</Chip>}
          </div>
          <h1 className="display text-2xl sm:text-3xl">{c.title}</h1>
          <Link href={`/u/${c.brand.username}`} className="mt-2 inline-flex items-center gap-2 text-sm">
            <Avatar src={c.brand.avatar_url} name={c.brand.display_name} size="xs" />
            <span className="font-medium">{c.brand.display_name}</span>
            <span className="text-ink-3">· {c.published_at ? `published ${timeAgo(c.published_at)}` : `created ${timeAgo(c.created_at)}`}</span>
          </Link>
        </div>
        <div className="text-right">
          <p className="display text-xl">{money(c.budget_min, c.budget_max, c.currency)}</p>
          <p className="text-xs text-ink-3">{c.creators_needed} creator{c.creators_needed > 1 ? "s" : ""} needed</p>
        </div>
      </div>
      {isOwner && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {c.stats && (
            <span className="mr-auto text-sm text-ink-2">
              <strong className="text-ink">{c.stats.applications}</strong> applications · <strong className="text-ink">{c.stats.shortlisted}</strong> shortlisted · <strong className="text-ink">{c.stats.selected}</strong> selected
            </span>
          )}
          {c.status === "draft" && <Button variant="primary" loading={busy} onClick={() => changeStatus("active")}><Rocket /> Publish</Button>}
          {c.status === "active" && (
            <>
              <Link href={`/swipe?campaign=${c.id}`} className={buttonVariants({ variant: "dark" })}><Layers /> Swipe matches</Link>
              <Button loading={busy} onClick={() => changeStatus("completed")}><CheckCircle2 /> Mark completed</Button>
            </>
          )}
          {c.status === "completed" && <Button loading={busy} onClick={() => changeStatus("active")}><RotateCcw /> Reopen</Button>}
          <Menu>
            <MenuTrigger asChild><Button size="icon" variant="ghost" aria-label="More"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => router.push(`/campaigns/${c.id}/edit`)}><Pencil /> Edit brief</MenuItem>
              {c.status === "active" && <MenuItem onSelect={() => changeStatus("draft")}><RotateCcw /> Unpublish</MenuItem>}
              <MenuItem onSelect={remove} danger><Trash2 /> Delete</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      )}
    </section>
  );

  if (!isOwner) {
    return (
      <div className="space-y-5">
        {header}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <BriefDetails campaign={c} />
          <aside className="lg:sticky lg:top-24 lg:h-fit">
            {me.role === "creator" ? <ApplyPanel campaign={c} onChange={() => q.refetch()} /> : null}
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <SegmentedTabs
        value={tab}
        onChange={(t) => router.replace(`/campaigns/${c.id}?tab=${t}`, { scroll: false })}
        items={[
          { value: "matches", label: "Ranked matches" },
          { value: "applications", label: "Applications", count: c.stats?.applications },
          { value: "pipeline", label: "Shortlist & selected", count: (c.stats?.shortlisted ?? 0) + (c.stats?.selected ?? 0) },
          { value: "brief", label: "Brief" },
        ]}
      />
      {tab === "matches" && <MatchesTab campaign={c} />}
      {tab === "applications" && <ApplicationsTab campaign={c} />}
      {tab === "pipeline" && <PipelineTab campaign={c} />}
      {tab === "brief" && <BriefDetails campaign={c} />}
    </div>
  );
}
