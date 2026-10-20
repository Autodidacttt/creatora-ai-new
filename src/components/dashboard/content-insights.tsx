"use client";

import { Trophy } from "lucide-react";
import type { ContentGroup, ContentInsights } from "@/services/dashboard";
import { compact } from "@/lib/utils";
import { ChartCard, DataTable, fmtPct } from "./chart-kit";

const DIMENSIONS: { key: keyof ContentInsights; title: string; hint: string }[] = [
  { key: "content_type", title: "Content type", hint: "Best format" },
  { key: "category", title: "Category / niche", hint: "Best niche" },
  { key: "platform", title: "Platform / source", hint: "Best platform" },
  { key: "tool", title: "AI tools used", hint: "Top tool" },
  { key: "style", title: "Creative style", hint: "Best style" },
];

const MIN_VIEWS_FOR_BEST = 20; // avoid crowning a group from a handful of views

function best(items: ContentGroup[]) {
  const eligible = items.filter((i) => i.views >= MIN_VIEWS_FOR_BEST && i.engagement_rate != null);
  return eligible.sort((a, b) => Number(b.engagement_rate) - Number(a.engagement_rate))[0] ?? null;
}

export function ContentInsightsSection({ data, loading, error, retry }: { data?: ContentInsights; loading: boolean; error: unknown; retry: () => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {DIMENSIONS.map((d) => {
        const items = (data?.[d.key] ?? []).filter((i) => i.posts > 0);
        const top = best(items);
        const max = Math.max(1, ...items.map((i) => i.views));
        return (
          <ChartCard
            key={d.key}
            title={d.title}
            subtitle={top ? <span><Trophy className="-mt-0.5 mr-1 inline size-3" aria-hidden />{d.hint}: <b className="text-ink">{top.label}</b> · {fmtPct(Number(top.engagement_rate))} engagement</span> : "Views by group, with engagement rate"}
            isLoading={loading} error={error} onRetry={retry} skeleton="bars"
            isEmpty={!loading && items.length === 0}
            empty={<p>Add {d.title.toLowerCase()} details to your posts to see this.</p>}
            table={<DataTable head={["Group", "Posts", "Views", "Engagements", "Engagement"]}
              rows={items.map((i) => [i.label, i.posts, i.views, i.engagements, fmtPct(i.engagement_rate == null ? null : Number(i.engagement_rate))])} />}
          >
            <ul className="space-y-2.5">
              {items.slice(0, 5).map((i) => (
                <li key={i.label} className="text-xs">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{i.label}</span>
                    <span className="shrink-0 tabular-nums text-ink-2">{compact(i.views)} views · {fmtPct(i.engagement_rate == null ? null : Number(i.engagement_rate))}</span>
                  </div>
                  <div className="h-2 rounded-full bg-ink/[0.06]">
                    <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${(i.views / max) * 100}%`, background: top?.label === i.label ? "var(--chart-1)" : "var(--chart-2)" }} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-3">{i.posts} post{i.posts === 1 ? "" : "s"}</p>
                </li>
              ))}
            </ul>
          </ChartCard>
        );
      })}
    </div>
  );
}
