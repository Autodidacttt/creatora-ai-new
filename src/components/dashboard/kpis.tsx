"use client";

import { Briefcase, Eye, HandCoins, Heart, UserPlus, Users } from "lucide-react";
import type { SeriesPoint, Summary } from "@/services/dashboard";
import { Counter } from "@/components/ui/counter";
import { compact } from "@/lib/utils";
import { DeltaBadge, Sparkline, fmtMoney } from "./chart-kit";

/** Six headline numbers with count-up, delta vs previous period and a sparkline. */
export function KpiGrid({ summary, series, loading }: { summary?: Summary; series?: SeriesPoint[]; loading: boolean }) {
  if (loading || !summary || !series) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="glass h-36 rounded-[1.5rem] p-4">
            <div className="h-3 w-20 animate-pulse rounded bg-ink/[0.07]" />
            <div className="mt-3 h-7 w-24 animate-pulse rounded bg-ink/[0.07]" />
            <div className="mt-6 h-8 animate-pulse rounded bg-ink/[0.05]" />
          </div>
        ))}
      </div>
    );
  }
  const c = summary.current;
  const p = summary.previous;
  let running = 0;
  const spark = series.map((d) => {
    running += Number(d.earnings);
    return { ...d, earnings_cum: running, engagement_rate_7d: d.engagement_rate_7d == null ? null : Number(d.engagement_rate_7d) };
  });
  const cards = [
    { key: "views", label: "Total views", icon: Eye, value: c.views ?? 0, prev: p.views, spark: "views" },
    { key: "followers", label: "Followers", icon: Users, value: c.followers ?? 0, prev: p.followers, spark: "followers",
      note: c.new_followers ? `+${compact(c.new_followers)} new` : undefined },
    { key: "er", label: "Engagement rate", icon: Heart, value: c.engagement_rate == null ? 0 : Number(c.engagement_rate), prev: p.engagement_rate == null ? null : Number(p.engagement_rate),
      spark: "engagement_rate_7d", points: true, format: (n: number) => (c.engagement_rate == null ? "—" : `${n.toFixed(1)}%`),
      note: "(likes + comments + saves) ÷ views" },
    { key: "visits", label: "Profile visits", icon: UserPlus, value: c.visits ?? 0, prev: p.visits, spark: "visits" },
    { key: "inquiries", label: "Brand inquiries", icon: Briefcase, value: c.inquiries ?? 0, prev: p.inquiries, spark: "inquiries",
      note: "Brands who messaged you first" },
    { key: "earnings", label: "Earnings", icon: HandCoins, value: Number(c.earnings ?? 0), prev: p.earnings == null ? null : Number(p.earnings), spark: "earnings_cum",
      format: (n: number) => fmtMoney(Math.round(n), summary.currency),
      note: summary.pending_payments ? `${fmtMoney(summary.pending_payments, summary.currency)} pending` : "Paid in this period" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((k) => (
        <article key={k.key} className="glass group flex flex-col rounded-[1.5rem] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 truncate text-xs font-medium text-ink-2">
              <k.icon className="size-3.5 shrink-0" aria-hidden /> {k.label}
            </p>
          </div>
          <p className="display mt-2 text-2xl tabular-nums sm:text-[1.7rem]">
            <Counter value={k.value} formatter={k.format} />
          </p>
          <div className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5">
            <DeltaBadge current={k.value} previous={k.prev} mode={k.points ? "points" : "percent"} />
          </div>
          <div className="mt-auto pt-2"><Sparkline data={spark} dataKey={k.spark} id={k.key} /></div>
          {k.note && <p className="truncate text-[10px] text-ink-3" title={k.note}>{k.note}</p>}
        </article>
      ))}
    </div>
  );
}
