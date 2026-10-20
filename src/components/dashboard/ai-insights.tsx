"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Lightbulb, RefreshCw, Sparkles, TrendingUp, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { getCachedInsights, refreshInsights, type AIInsights } from "@/services/dashboard";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { errorMessage, plural, timeAgo } from "@/lib/utils";
import { CardSkeleton } from "./chart-kit";

function Evidence({ e }: { e: AIInsights["strongest"][number]["evidence"] }) {
  const parts = [
    e.posts ? plural(e.posts, "relevant post") : null,
    e.campaigns ? plural(e.campaigns, "campaign") : null,
    e.workflows ? plural(e.workflows, "documented workflow") : null,
  ].filter(Boolean);
  return <span className="text-ink-3">Based on: {parts.join(", ") || "profile data"}</span>;
}

/** Evidence-first insights. The AI only phrases and ranks; every count shown comes from the database. */
export function AIInsightsSection() {
  const db = useDb();
  const me = useMe();
  const qc = useQueryClient();
  const cached = useQuery({ queryKey: ["dashboard", "insights", me.id], queryFn: () => getCachedInsights(db, me.id) });
  const refresh = useMutation({
    mutationFn: refreshInsights,
    onSuccess: (data) => {
      qc.setQueryData(["dashboard", "insights", me.id], data);
      toast.success(data.ai ? "Insights refreshed" : "Refreshed from your data (AI unavailable right now)");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ins = cached.data;

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] bg-ink p-5 text-bg sm:p-7" aria-labelledby="ai-h">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-amber/30 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="ai-h" className="display flex items-center gap-2 text-xl"><Wand2 className="size-5 text-amber" /> AI insights</h3>
            <p className="mt-1 text-xs text-bg/60">
              Generated from your aggregated stats. Every number below is a real count from your data; the AI only ranks and phrases.
              {ins && <> · {ins.ai ? `Written by ${ins.model ?? "Gemini"}` : "Ranked from your data — AI was unavailable"} · updated {timeAgo(ins.generated_at)}</>}
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => refresh.mutate()} loading={refresh.isPending}>
            <RefreshCw /> {ins ? "Refresh" : "Generate insights"}
          </Button>
        </div>

        {cached.isPending && <div className="mt-5 opacity-30"><CardSkeleton kind="bars" /></div>}
        {cached.isError && <p className="mt-5 text-sm text-bg/70">Couldn&apos;t load saved insights. <button className="underline" onClick={() => cached.refetch()}>Retry</button></p>}
        {cached.isSuccess && !ins && !refresh.isPending && (
          <p className="mt-5 max-w-lg text-sm text-bg/70">No insights yet. Generate them to see your strongest areas, matching briefs and content ideas — each backed by your real numbers.</p>
        )}

        {ins && (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-white/[0.06] p-4">
              <p className="eyebrow !text-bg/50">Strongest areas</p>
              {ins.strongest.length ? (
                <>
                  <p className="display mt-1 text-lg">{ins.strongest.map((s) => s.label).join(" · ")}</p>
                  <ul className="mt-3 space-y-1.5 text-xs">
                    {ins.strongest.map((s) => (
                      <li key={s.id}><b className="text-bg">{s.label}</b>{s.label.toLowerCase() !== s.evidence.label.toLowerCase() && <span className="text-bg/40"> ({s.evidence.label})</span>} — <Evidence e={s.evidence} /></li>
                    ))}
                  </ul>
                </>
              ) : <p className="mt-2 text-sm text-bg/60">Not enough evidence yet — add posts with tools, category and style.</p>}
              <p className="mt-3 text-[11px] text-bg/40">
                Overall: {plural(ins.totals.posts, "post")}, {plural(ins.totals.workflow_posts, "documented workflow")}, {plural(ins.totals.campaigns, "campaign")} applied to or hired for.
              </p>
            </div>

            <div className="rounded-2xl bg-white/[0.06] p-4">
              <p className="eyebrow !text-bg/50">Recommended opportunities</p>
              {ins.opportunities.length ? (
                <ul className="mt-2 space-y-2">
                  {ins.opportunities.map((o) => (
                    <li key={o.id}>
                      <Link href={`/campaigns/${o.id}`} className="group flex items-start gap-3 rounded-xl p-2 hover:bg-white/[0.06]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{o.title}</span>
                          <span className="block text-xs text-bg/60">{o.brand} · {o.why}</span>
                        </span>
                        <span className="shrink-0 text-right text-xs"><b className="block text-base tabular-nums text-amber">{o.score}</b><span className="text-bg/40">relevance</span></span>
                        <ArrowUpRight className="mt-1 size-4 shrink-0 text-bg/40 group-hover:text-amber" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-bg/60">No open briefs match right now.</p>}
            </div>

            <div className="rounded-2xl bg-white/[0.06] p-4">
              <p className="eyebrow flex items-center gap-1.5 !text-bg/50"><Lightbulb className="size-3" /> Content ideas</p>
              {ins.ideas.length ? (
                <ul className="mt-2 space-y-2.5 text-sm">
                  {ins.ideas.map((i, n) => (
                    <li key={n}>
                      <p>{i.idea}</p>
                      {i.based_on.length > 0 && <p className="mt-0.5 text-[11px] text-bg/40">Connects: {i.based_on.map((b) => b.label).join(" + ")}</p>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-sm text-bg/60">{ins.ai ? "No ideas this time — try refreshing." : "Content ideas need the AI, which is unavailable right now."}</p>}
            </div>

            <div className="rounded-2xl bg-white/[0.06] p-4">
              <p className="eyebrow flex items-center gap-1.5 !text-bg/50"><TrendingUp className="size-3" /> What brands are looking for</p>
              <p className="mt-2 text-sm">{ins.brands_want}</p>
              {ins.ai && <p className="mt-1 text-[10px] text-bg/40">AI-written summary of {plural(ins.totals.active_campaigns, "active brief")}.</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ins.trending.map((t) => (
                  <Chip key={t.id} className="!bg-white/10 !text-bg"><Sparkles className="size-3" /> {t.label} · {plural(t.campaigns, "brief")}</Chip>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
