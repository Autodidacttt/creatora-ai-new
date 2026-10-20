"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarRange, Download, ImagePlus, Sparkles } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import {
  getAudience, getCareer, getContentInsights, getPostPerformance, getSeries, getSummary, previousRange, type DateRange,
} from "@/services/dashboard";
import { SegmentedTabs } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PostModal } from "@/components/posts/post-grid";
import { KpiGrid } from "./kpis";
import { ContentPerformance, FollowerGrowth, TopPosts, ViewsAndEngagement } from "./performance";
import { AudienceSection } from "./audience";
import { ContentInsightsSection } from "./content-insights";
import { CareerSection } from "./career";
import { AIInsightsSection } from "./ai-insights";
import { fmtDay } from "./chart-kit";

type Preset = "7d" | "30d" | "90d" | "custom";
const PRESET_DAYS: Record<Exclude<Preset, "custom">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const SECTIONS = [
  { id: "performance", label: "Performance" },
  { id: "audience", label: "Audience" },
  { id: "content", label: "Content" },
  { id: "career", label: "Career" },
  { id: "insights", label: "AI insights" },
];

const todayUtc = () => new Date().toISOString().slice(0, 10);
const shift = (d: string, days: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const validDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function CreatorDashboard() {
  const me = useMe();
  const db = useDb();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Range + compare live in the URL so a view is shareable and survives reloads
  const preset = (["7d", "30d", "90d", "custom"].includes(params.get("range") ?? "") ? params.get("range") : "30d") as Preset;
  const compare = params.get("compare") === "1";
  const range: DateRange = useMemo(() => {
    if (preset === "custom" && validDate(params.get("from")) && validDate(params.get("to")) && params.get("from")! <= params.get("to")!) {
      return { from: params.get("from")!, to: params.get("to")! };
    }
    const to = todayUtc();
    return { from: shift(to, -((PRESET_DAYS[preset as Exclude<Preset, "custom">] ?? 30) - 1)), to };
  }, [preset, params]);
  const prev = previousRange(range);

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null ? p.delete(k) : p.set(k, v)));
    p.delete("post");
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const openPost = (id: string) => {
    const p = new URLSearchParams(params);
    p.set("post", id);
    router.push(`${pathname}?${p}`, { scroll: false });
  };

  const key = (k: string, r = range) => ["dashboard", k, me.id, r.from, r.to];
  const summary = useQuery({ queryKey: key("summary"), queryFn: () => getSummary(db, me.id, range) });
  const series = useQuery({ queryKey: key("series"), queryFn: () => getSeries(db, me.id, range) });
  const prevSeries = useQuery({ queryKey: key("series", prev), queryFn: () => getSeries(db, me.id, prev), enabled: compare });
  const posts = useQuery({ queryKey: key("posts"), queryFn: () => getPostPerformance(db, me.id, range) });
  const audience = useQuery({ queryKey: key("audience"), queryFn: () => getAudience(db, me.id, range) });
  const content = useQuery({ queryKey: key("content"), queryFn: () => getContentInsights(db, me.id, range) });
  const career = useQuery({ queryKey: key("career"), queryFn: () => getCareer(db, me.id, range) });

  const isNew = summary.data && !summary.data.has_activity && summary.data.posts === 0;

  function exportCsv() {
    if (!series.data) return;
    const head = ["day", "views", "watch_seconds", "likes", "comments", "saves", "engagement_rate_7d_pct", "new_followers", "followers", "profile_visits", "brand_inquiries", "earnings"];
    const rows = series.data.map((d) => [d.day, d.views, Math.round(d.watch_ms / 1000), d.likes, d.comments, d.saves, d.engagement_rate_7d ?? "", d.new_followers, d.followers, d.visits, d.inquiries, d.earnings]);
    const csv = [head, ...rows].map((r) => r.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `creatora-performance-${range.from}-to-${range.to}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Sticky controls: one row above everything they scope */}
      <div className="sticky top-14 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-[1.5rem] border border-glass-border bg-bg/90 px-3 py-2 shadow-soft backdrop-blur-xl">
        <Link href={`/u/${me.username}`} className="grid size-9 place-items-center rounded-full hover:bg-ink/5" aria-label="Back to profile"><ArrowLeft className="size-4" /></Link>
        <h1 className="display mr-auto text-lg sm:text-xl">Creator dashboard</h1>
        <SegmentedTabs size="sm" value={preset} onChange={(v) => {
          if (v === "custom") setParams({ range: "custom", from: range.from, to: range.to });
          else setParams({ range: v, from: null, to: null });
        }} items={[{ value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "90d", label: "90D" }, { value: "custom", label: "Custom" }]} />
        {preset === "custom" && <CustomRange range={range} onApply={(r) => setParams({ range: "custom", ...r })} />}
        <label className="flex items-center gap-2 rounded-full px-2 text-xs font-medium">
          <Switch checked={compare} onCheckedChange={(v) => setParams({ compare: v ? "1" : null })} label="Compare to previous period" />
          <span className="hidden sm:inline">Compare</span>
        </label>
        <select
          aria-label="Jump to section"
          className="hidden h-9 rounded-full border border-line bg-card px-3 text-xs sm:block"
          value=""
          onChange={(e) => { document.getElementById(e.target.value)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
        >
          <option value="" disabled>Jump to…</option>
          {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!series.data} aria-label="Export performance as CSV"><Download /> <span className="hidden md:inline">CSV</span></Button>
        <p className="w-full text-[11px] text-ink-3">
          {fmtDay(range.from, { month: "short", day: "numeric", year: "numeric" })} – {fmtDay(range.to, { month: "short", day: "numeric", year: "numeric" })} (UTC)
          {compare && <> · compared with {fmtDay(prev.from)} – {fmtDay(prev.to)}</>}
        </p>
      </div>

      {isNew && (
        <div className="glass flex flex-wrap items-center gap-4 rounded-[1.75rem] p-5">
          <span className="grid size-12 place-items-center rounded-full bg-amber-soft"><Sparkles className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Your dashboard fills up as people discover your work</p>
            <p className="text-sm text-ink-2">Publish your first portfolio piece — views, followers and engagement will appear here from real activity.</p>
          </div>
          <Link href="/posts/new" className={buttonVariants({ variant: "primary" })}><ImagePlus /> Add a piece</Link>
        </div>
      )}

      <KpiGrid summary={summary.data} series={series.data} loading={summary.isPending || series.isPending} />
      {(summary.isError || series.isError) && (
        <p role="alert" className="text-sm text-danger">Couldn&apos;t load your numbers. <button className="underline" onClick={() => { summary.refetch(); series.refetch(); }}>Retry</button></p>
      )}

      <section id="performance" className="scroll-mt-36 space-y-4">
        <h2 className="display text-xl">Performance</h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <ViewsAndEngagement series={series.data} previous={prevSeries.data} compare={compare} loading={series.isPending || (compare && prevSeries.isPending)} error={series.error} retry={() => series.refetch()} />
          <FollowerGrowth series={series.data} previous={prevSeries.data} compare={compare} loading={series.isPending} error={series.error} retry={() => series.refetch()} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ContentPerformance posts={posts.data} loading={posts.isPending} error={posts.error} retry={() => posts.refetch()} onOpen={openPost} />
          <TopPosts posts={posts.data} loading={posts.isPending} error={posts.error} retry={() => posts.refetch()} onOpen={openPost} />
        </div>
      </section>

      <section id="audience" className="scroll-mt-36 space-y-4">
        <h2 className="display text-xl">Audience</h2>
        <AudienceSection audience={audience.data} series={series.data} loading={audience.isPending || series.isPending} error={audience.error} retry={() => audience.refetch()} />
      </section>

      <section id="content" className="scroll-mt-36 space-y-4">
        <h2 className="display text-xl">Content insights</h2>
        <ContentInsightsSection data={content.data} loading={content.isPending} error={content.error} retry={() => content.refetch()} />
      </section>

      <section id="career" className="scroll-mt-36 space-y-4">
        <h2 className="display text-xl">Career & marketplace</h2>
        <CareerSection career={career.data} currency={summary.data?.currency ?? "USD"} loading={career.isPending} error={career.error} retry={() => career.refetch()} />
      </section>

      <section id="insights" className="scroll-mt-36 space-y-4">
        <h2 className="display text-xl">AI insights</h2>
        <AIInsightsSection />
      </section>

      <PostModal />
    </div>
  );
}

function CustomRange({ range, onApply }: { range: DateRange; onApply: (r: DateRange) => void }) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  const invalid = !from || !to || from > to || days > 366;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-card px-3 text-xs"><CalendarRange className="size-3.5" /> {fmtDay(range.from)} – {fmtDay(range.to)}</button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3">
        <label className="block text-xs font-medium">From<Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9" /></label>
        <label className="block text-xs font-medium">To<Input type="date" value={to} min={from} max={todayUtc()} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9" /></label>
        {invalid && <p className="text-[11px] text-danger">Pick a valid range of up to one year.</p>}
        <Button size="sm" variant="primary" className="w-full" disabled={invalid} onClick={() => onApply({ from, to })}>Apply</Button>
      </PopoverContent>
    </Popover>
  );
}
