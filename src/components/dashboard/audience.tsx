"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Lock } from "lucide-react";
import type { Audience, GroupCount, SeriesPoint } from "@/services/dashboard";
import { compact } from "@/lib/utils";
import { ChartCard, DataTable, GlassTip, SERIES, axisProps, fmtDay, useChartAnimation } from "./chart-kit";

function RankedBars({ items, unit = "people" }: { items: GroupCount[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-2">
      {items.slice(0, 6).map((g) => (
        <li key={g.label} className="text-xs">
          <div className="mb-1 flex justify-between gap-2"><span className="truncate">{g.label}</span><span className="tabular-nums text-ink-2">{g.count} {unit}</span></div>
          <div className="h-2 rounded-full bg-ink/[0.06]"><div className="h-2 rounded-full bg-chart-1 transition-all duration-700" style={{ width: `${(g.count / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function GroupPanel({ title, items, hidden, min }: { title: string; items?: GroupCount[]; hidden?: number; min: number }) {
  return (
    <div className="rounded-2xl bg-card/70 p-3.5">
      <p className="mb-2.5 text-xs font-semibold">{title}</p>
      {items && items.length ? (
        <>
          <RankedBars items={items} />
          {!!hidden && <p className="mt-2 text-[10px] text-ink-3">{hidden} more in groups smaller than {min} (hidden for privacy)</p>}
        </>
      ) : (
        <div className="flex items-start gap-2 text-xs text-ink-2">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
          <p>Not enough data yet. Groups are shown only once at least {min} people share them{hidden ? ` (${hidden} people in smaller groups so far)` : ""}.</p>
        </div>
      )}
    </div>
  );
}

export function AudienceSection({ audience, series, loading, error, retry }: {
  audience?: Audience;
  series?: SeriesPoint[];
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const anim = useChartAnimation();
  // Weekly buckets of new followers (aggregating the SQL daily series)
  const weekly = useMemo(() => {
    const out: { week: string; new_followers: number }[] = [];
    (series ?? []).forEach((d, i) => {
      if (i % 7 === 0) out.push({ week: d.day, new_followers: 0 });
      out[out.length - 1].new_followers += d.new_followers;
    });
    return out;
  }, [series]);
  const min = audience?.min_group ?? 5;
  const g = audience?.groups ?? {};
  const h = audience?.hidden ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard className="lg:col-span-2" title="Audience" subtitle="Registered people who follow you or engaged with your work in this period"
        isLoading={loading} error={error} onRetry={retry} skeleton="bars"
        isEmpty={!loading && (audience?.audience_size ?? 0) === 0}
        empty={<><p className="font-medium text-ink">No audience data yet</p><p>As signed-in people follow, view and engage with your work, a privacy-safe breakdown appears here.</p></>}>
        <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-2">
          <span><b className="text-base tabular-nums text-ink">{compact(audience?.audience_size ?? 0)}</b> registered people</span>
          <span><b className="text-base tabular-nums text-ink">{compact(audience?.followers ?? 0)}</b> followers</span>
          <span><b className="text-base tabular-nums text-ink">{compact(audience?.anonymous_views ?? 0)}</b> views without a known viewer</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <GroupPanel title="Top locations" items={g.locations} hidden={h.locations} min={min} />
          <GroupPanel title="Languages" items={g.languages} hidden={h.languages} min={min} />
          <GroupPanel title="Interests" items={g.interests} hidden={h.interests} min={min} />
          <GroupPanel title="Account types" items={g.roles} hidden={h.roles} min={min} />
        </div>
      </ChartCard>

      <ChartCard title="Audience growth" subtitle="New followers per week"
        isLoading={loading} error={error} onRetry={retry}
        isEmpty={!loading && weekly.every((w) => w.new_followers === 0)}
        empty={<><p className="font-medium text-ink">No new followers in this period</p></>}
        table={<DataTable head={["Week of", "New followers"]} rows={weekly.map((w) => [fmtDay(w.week), w.new_followers])} />}>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ top: 8, right: 4, bottom: 0, left: -10 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="week" tickFormatter={(d) => fmtDay(d)} minTickGap={16} {...axisProps} />
              <YAxis width={36} allowDecimals={false} {...axisProps} />
              <Tooltip cursor={{ fill: "var(--ink)", fillOpacity: 0.04 }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const w = payload[0].payload as (typeof weekly)[number];
                return <GlassTip title={`Week of ${fmtDay(w.week)}`} rows={[{ key: "n", label: "new followers", value: String(w.new_followers), color: SERIES.primary }]} />;
              }} />
              <Bar dataKey="new_followers" fill={SERIES.primary} radius={[4, 4, 0, 0]} {...anim} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    </div>
  );
}
