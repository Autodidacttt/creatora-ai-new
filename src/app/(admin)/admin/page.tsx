"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useDb } from "@/features/session";
import { getAdminStats } from "@/services/admin";
import { StatBlob } from "@/components/ui/stat-blob";
import { GlassPanel, SectionTitle } from "@/components/ui/glass";
import { ErrorState, Skeleton } from "@/components/ui/states";

export default function AdminDashboard() {
  const db = useDb();
  const q = useQuery({ queryKey: ["admin", "stats"], queryFn: () => getAdminStats(db) });
  if (q.isPending) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  const maxSignup = Math.max(1, ...s.signups_14d.map((d) => d.count));
  const maxTool = Math.max(1, ...s.top_tools.map((t) => t.count));

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Admin</p>
        <h1 className="display text-3xl">Platform overview</h1>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatBlob value={s.creators} label="Creators" href="/admin/users" accent />
        <StatBlob value={s.brands} label="Brands" href="/admin/users" />
        <StatBlob value={s.posts} label="Live portfolio pieces" href="/admin/content" />
        <StatBlob value={s.campaigns.active} label="Active briefs" href="/admin/campaigns" />
        <StatBlob value={s.pending_verifications} label="Verifications to review" href="/admin/verifications" accent={s.pending_verifications > 0} />
        <StatBlob value={s.open_reports} label="Open reports" href="/admin/reports" accent={s.open_reports > 0} />
        <StatBlob value={s.applications} label="Applications" />
        <StatBlob value={s.messages} label="Messages sent" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionTitle title="Sign-ups · last 14 days" className="mb-4" />
          <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Daily sign-ups bar chart">
            {s.signups_14d.map((d) => (
              <div key={d.day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] tabular-nums text-ink-3 opacity-0 group-hover:opacity-100">{d.count}</span>
                <div className="w-full rounded-t-lg bg-amber-2/80" style={{ height: `${Math.max(4, (d.count / maxSignup) * 100)}%` }} title={`${d.day}: ${d.count}`} />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-3">{s.verified_creators} verified creators · {s.suspended} suspended accounts · {s.removed_posts} removed posts</p>
        </GlassPanel>
        <GlassPanel className="p-5">
          <SectionTitle title="Most-listed AI tools" className="mb-4" />
          <ul className="space-y-2">
            {s.top_tools.map((t) => (
              <li key={t.name} className="grid grid-cols-[8rem_1fr_2rem] items-center gap-2 text-sm">
                <span className="truncate">{t.name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-ink/10"><span className="block h-full rounded-full bg-ink" style={{ width: `${(t.count / maxTool) * 100}%` }} /></span>
                <span className="text-right tabular-nums text-ink-3">{t.count}</span>
              </li>
            ))}
          </ul>
        </GlassPanel>
      </div>
      <GlassPanel className="flex flex-wrap items-center gap-3 p-5 text-sm">
        <span>Briefs: <strong>{s.campaigns.draft}</strong> draft · <strong>{s.campaigns.active}</strong> active · <strong>{s.campaigns.completed}</strong> completed</span>
        <span className="text-ink-3">·</span>
        <span><strong>{s.likes}</strong> likes · <strong>{s.follows}</strong> follows</span>
        <Link href="/admin/audit" className="ml-auto font-semibold underline-offset-4 hover:underline">View audit log →</Link>
      </GlassPanel>
    </div>
  );
}
