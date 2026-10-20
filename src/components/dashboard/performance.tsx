/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ImageOff, X } from "lucide-react";
import type { PostPerformance, SeriesPoint } from "@/services/dashboard";
import { SegmentedTabs } from "@/components/ui/tabs";
import { compact } from "@/lib/utils";
import { ChartCard, DataTable, GlassTip, LegendToggles, SERIES, axisProps, fmtDay, fmtPct, useChartAnimation } from "./chart-kit";

export type Metric = "views" | "likes" | "comments" | "saves";
const METRIC_LABEL: Record<Metric, string> = { views: "Views", likes: "Likes", comments: "Comments", saves: "Saves" };

interface Props {
  series?: SeriesPoint[];
  previous?: SeriesPoint[];
  compare: boolean;
  loading: boolean;
  error: unknown;
  retry: () => void;
}

/** Joins current and previous period by day offset so both share one x-axis. */
function joined(series: SeriesPoint[] = [], previous: SeriesPoint[] = []) {
  return series.map((d, i) => ({
    ...d,
    engagement_rate_7d: d.engagement_rate_7d == null ? null : Number(d.engagement_rate_7d),
    prev: previous[i] ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Views & engagement: metric chart + engagement-rate chart, synced crosshair (no dual axis)
// ---------------------------------------------------------------------------
export function ViewsAndEngagement({ series, previous, compare, loading, error, retry }: Props) {
  const anim = useChartAnimation();
  const [metric, setMetric] = useState<Metric>("views");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [day, setDay] = useState<string | null>(null);
  const data = useMemo(() => joined(series, previous).map((d) => ({ ...d, cur: d[metric], prevVal: d.prev ? d.prev[metric] : null })), [series, previous, metric]);
  const total = data.reduce((s, d) => s + d.cur, 0);
  const selected = day ? data.find((d) => d.day === day) : null;
  const toggle = (k: string) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <ChartCard
      className="lg:col-span-2"
      title="Views & engagement over time"
      subtitle={`${compact(total)} ${METRIC_LABEL[metric].toLowerCase()} in this period · click a day for details`}
      actions={<SegmentedTabs size="sm" value={metric} onChange={(m) => { setMetric(m); setDay(null); }}
        items={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />}
      isLoading={loading}
      error={error}
      onRetry={retry}
      isEmpty={!loading && total === 0 && data.every((d) => d.views === 0)}
      empty={<><p className="font-medium text-ink">No views in this period yet</p><p>Views appear as people open your work in the feed, reels and your profile.</p></>}
      table={<DataTable head={["Day", METRIC_LABEL[metric], ...(compare ? ["Previous"] : []), "Engagement (7-day)"]}
        rows={data.map((d) => [fmtDay(d.day), d.cur, ...(compare ? [d.prevVal ?? 0] : []), fmtPct(d.engagement_rate_7d)])} />}
    >
      {compare && (
        <div className="mb-2">
          <LegendToggles hidden={hidden} onToggle={toggle} items={[
            { key: "cur", label: "This period", color: SERIES.primary },
            { key: "prev", label: "Previous period", color: SERIES.secondary, dashed: true },
          ]} />
        </div>
      )}
      <div className="h-56 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} syncId="perf" margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
            onClick={(s) => { const l = (s as { activeLabel?: string | number } | null)?.activeLabel; if (l != null) setDay(String(l)); }}>
            <defs>
              <linearGradient id="fill-cur" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES.primary} stopOpacity={0.32} />
                <stop offset="100%" stopColor={SERIES.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" tickFormatter={(d) => fmtDay(d)} minTickGap={28} {...axisProps} />
            <YAxis width={48} tickFormatter={(n) => compact(n)} allowDecimals={false} {...axisProps} />
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
              content={({ active, label, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <GlassTip title={fmtDay(String(label), { weekday: "short", month: "short", day: "numeric" })} rows={[
                    ...(hidden.has("cur") ? [] : [{ key: "c", label: METRIC_LABEL[metric], value: compact(d.cur), color: SERIES.primary }]),
                    ...(compare && !hidden.has("prev") && d.prev ? [{ key: "p", label: `${METRIC_LABEL[metric]} · ${fmtDay(d.prev.day)}`, value: compact(d.prevVal ?? 0), color: SERIES.secondary, dashed: true }] : []),
                  ]} />
                );
              }}
            />
            {compare && !hidden.has("prev") && (
              <Area type="monotone" dataKey="prevVal" stroke={SERIES.secondary} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} activeDot={{ r: 4 }} {...anim} />
            )}
            {!hidden.has("cur") && (
              <Area type="monotone" dataKey="cur" stroke={SERIES.primary} strokeWidth={2} fill="url(#fill-cur)" dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }} {...anim} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-xs font-medium text-ink-2">Engagement rate · trailing 7 days</p>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId="perf" margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" hide />
            <YAxis width={44} tickFormatter={(n) => `${n}%`} {...axisProps} />
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
              content={({ active, label, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return <GlassTip title={fmtDay(String(label))} rows={[{ key: "er", label: "engagement (7-day)", value: fmtPct(d.engagement_rate_7d), color: SERIES.tertiary }]} />;
              }}
            />
            <Line type="monotone" dataKey="engagement_rate_7d" stroke={SERIES.tertiary} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4 }} {...anim} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {selected && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl bg-card px-4 py-2.5 text-xs">
          <span className="font-semibold">{fmtDay(selected.day, { weekday: "long", month: "short", day: "numeric" })}</span>
          <span><b className="tabular-nums">{compact(selected.views)}</b> views</span>
          <span><b className="tabular-nums">{selected.likes}</b> likes</span>
          <span><b className="tabular-nums">{selected.comments}</b> comments</span>
          <span><b className="tabular-nums">{selected.saves}</b> saves</span>
          <span><b className="tabular-nums">{selected.visits}</b> profile visits</span>
          <button onClick={() => setDay(null)} className="ml-auto rounded-full p-1 text-ink-3 hover:bg-ink/5" aria-label="Close day details"><X className="size-3.5" /></button>
        </div>
      )}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Follower growth
// ---------------------------------------------------------------------------
export function FollowerGrowth({ series, previous, compare, loading, error, retry }: Props) {
  const anim = useChartAnimation();
  const data = useMemo(() => joined(series, previous).map((d) => ({ ...d, prevFollowers: d.prev?.followers ?? null })), [series, previous]);
  const gained = data.reduce((s, d) => s + d.new_followers, 0);
  const end = data.at(-1)?.followers ?? 0;
  return (
    <ChartCard
      title="Follower growth"
      subtitle={`${compact(end)} followers · ${gained >= 0 ? "+" : ""}${gained} in this period`}
      isLoading={loading} error={error} onRetry={retry}
      isEmpty={!loading && end === 0}
      empty={<><p className="font-medium text-ink">No followers yet</p><p>Share your profile and keep posting — growth shows up here.</p></>}
      table={<DataTable head={["Day", "Followers", "New"]} rows={data.map((d) => [fmtDay(d.day), d.followers, d.new_followers])} />}
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="fill-followers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES.primary} stopOpacity={0.3} />
                <stop offset="100%" stopColor={SERIES.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="day" tickFormatter={(d) => fmtDay(d)} minTickGap={32} {...axisProps} />
            <YAxis width={40} allowDecimals={false} tickFormatter={(n) => compact(n)} domain={[0, "auto"]} {...axisProps} />
            <Tooltip
              cursor={{ stroke: "var(--ink-3)", strokeDasharray: "3 3" }}
              content={({ active, label, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return <GlassTip title={fmtDay(String(label))} rows={[
                  { key: "f", label: "followers", value: compact(d.followers), color: SERIES.primary },
                  ...(compare && d.prevFollowers != null ? [{ key: "p", label: "previous period", value: compact(d.prevFollowers), color: SERIES.secondary, dashed: true }] : []),
                ]} footer={d.new_followers ? `+${d.new_followers} new that day` : undefined} />;
              }}
            />
            {compare && <Area type="stepAfter" dataKey="prevFollowers" stroke={SERIES.secondary} strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} {...anim} />}
            <Area type="stepAfter" dataKey="followers" stroke={SERIES.primary} strokeWidth={2} fill="url(#fill-followers)" dot={false} activeDot={{ r: 4 }} {...anim} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {compare && <div className="mt-2"><LegendToggles hidden={new Set()} onToggle={() => undefined} items={[
        { key: "c", label: "This period", color: SERIES.primary }, { key: "p", label: "Previous period", color: SERIES.secondary, dashed: true }]} /></div>}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Content performance (bar per post) + top posts
// ---------------------------------------------------------------------------
export function ContentPerformance({ posts, loading, error, retry, onOpen }: {
  posts?: PostPerformance[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  onOpen: (postId: string) => void;
}) {
  const anim = useChartAnimation();
  const [metric, setMetric] = useState<Metric>("views");
  const data = useMemo(() => [...(posts ?? [])].sort((a, b) => b[metric] - a[metric]).slice(0, 10)
    .map((p) => ({ ...p, short: p.title.length > 14 ? `${p.title.slice(0, 13)}…` : p.title, value: p[metric] })), [posts, metric]);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <ChartCard
      title="Content performance"
      subtitle="Top posts in this period · click a bar to open the post"
      actions={<SegmentedTabs size="sm" value={metric} onChange={setMetric}
        items={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />}
      isLoading={loading} error={error} onRetry={retry} skeleton="bars"
      isEmpty={!loading && data.every((d) => d.value === 0)}
      empty={<><p className="font-medium text-ink">No {METRIC_LABEL[metric].toLowerCase()} in this period</p><p>Try a longer date range.</p></>}
      table={<DataTable head={["Post", "Views", "Likes", "Comments", "Saves", "Engagement"]}
        rows={(posts ?? []).map((p) => [p.title, p.views, p.likes, p.comments, p.saves, fmtPct(p.engagement_rate == null ? null : Number(p.engagement_rate))])} />}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -4 }} barCategoryGap="22%"
            onMouseLeave={() => setHover(null)}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="short" interval={0} angle={-30} textAnchor="end" height={56} {...axisProps} />
            <YAxis width={40} allowDecimals={false} tickFormatter={(n) => compact(n)} {...axisProps} />
            <Tooltip
              cursor={{ fill: "var(--ink)", fillOpacity: 0.04 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return <GlassTip title={p.title} rows={[
                  { key: "v", label: "views", value: compact(p.views), color: SERIES.primary },
                  { key: "l", label: "likes", value: String(p.likes), color: SERIES.primary },
                  { key: "c", label: "comments", value: String(p.comments), color: SERIES.primary },
                  { key: "s", label: "saves", value: String(p.saves), color: SERIES.primary },
                ]} footer={`Engagement ${fmtPct(p.engagement_rate == null ? null : Number(p.engagement_rate))} · click to open`} />;
              }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d) => onOpen((d as unknown as PostPerformance).post_id)}
              onMouseEnter={(_, i) => setHover(i)} {...anim}>
              {data.map((d, i) => (
                <Cell key={d.post_id} fill={SERIES.primary} fillOpacity={hover === null || hover === i ? 1 : 0.45} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function TopPosts({ posts, loading, error, retry, onOpen }: {
  posts?: PostPerformance[];
  loading: boolean;
  error: unknown;
  retry: () => void;
  onOpen: (postId: string) => void;
}) {
  const top = (posts ?? []).filter((p) => p.views > 0 || p.likes + p.comments + p.saves > 0).slice(0, 5);
  return (
    <ChartCard title="Top-performing posts" subtitle="Ranked by views, then engagement" isLoading={loading} error={error} onRetry={retry} skeleton="list"
      isEmpty={!loading && top.length === 0}
      empty={<><p className="font-medium text-ink">Nothing ranked yet</p><p>Your best work in this period will appear here.</p></>}>
      <ol className="space-y-2">
        {top.map((p, i) => (
          <li key={p.post_id}>
            <button onClick={() => onOpen(p.post_id)} className="flex w-full items-center gap-3 rounded-2xl p-1.5 text-left transition-colors hover:bg-ink/5">
              <span className="w-4 text-center text-xs font-semibold tabular-nums text-ink-3">{i + 1}</span>
              {p.thumbnail ? (
                <img src={p.thumbnail} alt="" className="size-11 shrink-0 rounded-xl object-cover" loading="lazy" />
              ) : (
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink/5"><ImageOff className="size-4 text-ink-3" /></span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.title}</span>
                <span className="block truncate text-xs tabular-nums text-ink-3">
                  {compact(p.views)} views · {p.likes} likes · {p.comments} comments · {p.saves} saves
                </span>
              </span>
              <span className="text-right text-xs tabular-nums">
                <b className="block text-sm">{fmtPct(p.engagement_rate == null ? null : Number(p.engagement_rate))}</b>
                <span className="text-ink-3">engagement</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </ChartCard>
  );
}
