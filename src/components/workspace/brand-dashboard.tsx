"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarClock, FileSearch, Sparkles, UserPlus, Zap } from "lucide-react";
import type { BrandOverview } from "@/types/workspace";
import { useDb } from "@/features/session";
import { getBrandOverview } from "@/services/workspace";
import { StatBlob } from "@/components/ui/stat-blob";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/states";
import { cn, timeAgo } from "@/lib/utils";
import { formatDateTime } from "@/lib/money";
import { Countdown } from "./countdown";
import { PROJECT_STATUS } from "./status";
import type { ProjectStatus } from "@/types/workspace";

function activityText(a: BrandOverview["activity"][number]) {
  const who = a.actor?.display_name ?? "Creatora";
  if (a.kind === "application") return `${who} applied`;
  if (a.kind === "payment") return `Payment ${a.event} (test mode)`;
  if (a.kind === "certificate") return `Licence record ${String(a.data.certificate_id ?? "")} issued`;
  const s = PROJECT_STATUS[a.event as ProjectStatus];
  return `${s?.label ?? a.event}${a.data.version ? ` · v${a.data.version}` : ""} — ${who}`;
}

function activityHref(a: BrandOverview["activity"][number]) {
  if (a.kind === "application") return `/brand/campaigns/hiring?tab=hiring&campaign=${a.campaign_id}`;
  if (["submitted", "resubmitted"].includes(a.event) && typeof a.data.submission_id === "string") return `/brand/campaigns/review?submission=${a.data.submission_id}`;
  return a.project_id ? `/brand/campaigns/projects/${a.project_id}` : `/campaigns/${a.campaign_id}`;
}

function Shortcut({ href, icon, title, hint, badge, primary }: { href: string; icon: React.ReactNode; title: string; hint: string; badge?: number; primary?: boolean }) {
  return (
    <Link href={href} className={cn("group relative flex items-center gap-3 rounded-[1.75rem] p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift",
      primary ? "bg-ink text-bg" : "glass")}>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl [&_svg]:size-5", primary ? "bg-amber text-on-amber" : "bg-amber-soft text-ink")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className={cn("block text-xs", primary ? "text-bg/60" : "text-ink-2")}>{hint}</span>
      </span>
      {!!badge && (
        <span className="grid min-w-6 place-items-center rounded-full bg-amber px-1.5 py-0.5 text-xs font-bold text-on-amber" aria-label={`${badge} waiting`}>{badge}</span>
      )}
    </Link>
  );
}

/** Campaigns landing for brands: live counts, shortcuts into the workspace, activity and deadlines. */
export function BrandDashboard() {
  const db = useDb();
  const q = useQuery({ queryKey: ["brand-overview"], queryFn: () => getBrandOverview(db), refetchInterval: 30_000 });
  const o = q.data;

  return (
    <div className="space-y-5">
      {q.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-[1.75rem]" />)}</div>
      ) : o ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatBlob value={o.campaigns} label={`Campaigns · ${o.active_campaigns} live`} accent />
          <StatBlob value={o.creators_hired} label="Creators hired" href="/brand/campaigns/hiring?tab=delivery" />
          <StatBlob value={o.active_projects} label="Active projects" href="/brand/campaigns/hiring?tab=delivery" />
          <StatBlob value={o.pending_reviews} label="Pending reviews" href="/brand/campaigns/review" />
          <StatBlob value={o.unread_messages} label="Unread messages" href="/inbox" className="col-span-2 sm:col-span-1" />
        </div>
      ) : q.isError ? (
        <p className="text-sm text-ink-2">Couldn&apos;t load your dashboard. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Shortcut primary href="/brand/campaigns/studio" icon={<Sparkles />} title="Create campaign" hint="Idea → AI brief → guidelines → creators" />
        <Shortcut href="/brand/campaigns/review" icon={<FileSearch />} title="Review content" hint="Watermarked previews + AI checks" badge={o?.pending_reviews} />
        <Shortcut href="/brand/campaigns/hiring" icon={<UserPlus />} title="Hire creators" hint="48h sprints, candidates, delivery" badge={o?.awaiting_payment} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="glass min-w-0 rounded-[1.75rem] p-5" aria-labelledby="act-h">
          <h2 id="act-h" className="mb-3 flex items-center gap-2 text-sm font-semibold"><Activity className="size-4" /> Recent activity</h2>
          {q.isPending && <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>}
          {o && o.activity.length === 0 && <p className="text-sm text-ink-2">Activity on your campaigns — applications, submissions, payments — appears here.</p>}
          <ul className="divide-y divide-line">
            {o?.activity.slice(0, 8).map((a, i) => (
              <li key={`${a.created_at}-${i}`}>
                <Link href={activityHref(a)} className="flex items-center gap-3 rounded-xl py-2.5 hover:bg-ink/[0.03]">
                  <Avatar src={a.actor?.avatar_url} name={a.actor?.display_name ?? "Creatora"} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{activityText(a)}</span>
                    <span className="block truncate text-xs text-ink-3">{a.campaign_title}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-3">{timeAgo(a.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="glass min-w-0 rounded-[1.75rem] p-5" aria-labelledby="dl-h">
          <h2 id="dl-h" className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4" /> Upcoming deadlines</h2>
          {o && o.deadlines.length === 0 && <p className="text-sm text-ink-2">No live deadlines.</p>}
          <ul className="space-y-2.5">
            {o?.deadlines.map((d) => (
              <li key={d.campaign_id}>
                <Link href={`/campaigns/${d.campaign_id}`} className="block rounded-2xl bg-card/70 p-3 hover:bg-card">
                  <span className="flex items-center gap-1.5 text-sm font-medium">{d.is_sprint && <Zap className="size-3.5 text-amber-ink" aria-label="Sprint" />}<span className="truncate">{d.title}</span></span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                    {d.is_sprint ? <Countdown to={d.due_at} compact /> : <span>Due {formatDateTime(d.due_at)}</span>}
                    <span>{d.open_projects} active project{d.open_projects === 1 ? "" : "s"}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
