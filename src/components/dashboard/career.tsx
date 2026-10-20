"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Career } from "@/services/dashboard";
import { Counter } from "@/components/ui/counter";
import { Chip } from "@/components/ui/chip";
import { cn, timeAgo } from "@/lib/utils";
import { ChartCard, fmtMoney, fmtPct } from "./chart-kit";

function stageOf(r: Career["rows"][number]) {
  if (r.hire_status === "completed") return { label: "Completed", tone: "dark" as const };
  if (r.hired_at) return { label: "Hired", tone: "success" as const };
  if (r.shortlisted_at) return { label: "Shortlisted", tone: "amber" as const };
  if (r.app_status === "rejected") return { label: "Declined", tone: "danger" as const };
  return { label: "Applied", tone: "outline" as const };
}

export function CareerSection({ career, currency, loading, error, retry }: {
  career?: Career;
  currency: string;
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const c = career;
  const steps = c ? [
    { label: "Applications", value: c.applications },
    { label: "Shortlisted", value: c.shortlisted },
    { label: "Hired", value: c.hired },
    { label: "Completed", value: c.completed },
  ] : [];
  const success = c && c.applications > 0 ? (100 * c.hired_from_applications) / c.applications : null;
  const empty = !!c && c.applications + c.shortlisted + c.hired + c.completed === 0 && c.rows.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard className="lg:col-span-2" title="Marketplace pipeline" subtitle="In the selected period"
        isLoading={loading} error={error} onRetry={retry} skeleton="bars" isEmpty={!loading && empty}
        empty={<><p className="font-medium text-ink">No campaign activity yet</p><p>Apply to briefs that match your work — your pipeline appears here.</p><Link href="/opportunities" className="mt-2 rounded-full bg-amber px-4 py-2 text-xs font-semibold text-on-amber">Browse opportunities</Link></>}>
        <ol className="flex flex-wrap items-stretch gap-2" aria-label="Pipeline">
          {steps.map((s, i) => (
            <li key={s.label} className="flex flex-1 items-center gap-2">
              <div className={cn("min-w-24 flex-1 rounded-2xl px-3 py-2.5", i === 2 ? "bg-amber text-on-amber" : "bg-card")}>
                <p className="display text-2xl tabular-nums"><Counter value={s.value} format="plain" /></p>
                <p className={cn("text-[11px]", i === 2 ? "text-on-amber/80" : "text-ink-3")}>{s.label}</p>
              </div>
              {i < steps.length - 1 && <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-ink-2">
          Campaign success rate: <b className="tabular-nums text-ink">{fmtPct(success, 0)}</b> <span className="text-ink-3">(hired after applying ÷ applications{c ? ` · ${c.hired_from_applications}/${c.applications}` : ""})</span>
          {c && c.active > 0 && <> · <b className="text-ink">{c.active}</b> active now</>}
        </p>
        {c && c.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead><tr className="text-ink-3"><th className="py-1.5 font-medium">Campaign</th><th className="font-medium">Brand</th><th className="font-medium">Stage</th><th className="font-medium">Amount</th><th className="font-medium">Payment</th><th className="font-medium">Updated</th></tr></thead>
              <tbody>
                {c.rows.map((r) => {
                  const st = stageOf(r);
                  return (
                    <tr key={r.campaign_id} className="border-t border-line">
                      <td className="max-w-48 truncate py-2 pr-2"><Link href={`/campaigns/${r.campaign_id}`} className="font-medium hover:underline">{r.title}</Link></td>
                      <td className="pr-2">{r.brand}</td>
                      <td className="pr-2"><Chip tone={st.tone}>{st.label}</Chip></td>
                      <td className="pr-2 tabular-nums">{r.agreed_amount != null ? fmtMoney(r.agreed_amount, r.currency) : "—"}</td>
                      <td className="pr-2">{r.payment_status ? <Chip tone={r.payment_status === "paid" ? "success" : "outline"} className="capitalize">{r.payment_status}</Chip> : "—"}</td>
                      <td className="text-ink-3">{r.last_activity ? timeAgo(r.last_activity) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Earnings" subtitle="From hired campaigns" isLoading={loading} error={error} onRetry={retry} skeleton="bars">
        <div className="space-y-3">
          <div className="rounded-2xl bg-card p-3.5">
            <p className="text-[11px] text-ink-3">Paid in this period</p>
            <p className="display text-2xl tabular-nums"><Counter value={c?.earned_in_range ?? 0} formatter={(n) => fmtMoney(Math.round(n), currency)} /></p>
          </div>
          <div className="rounded-2xl bg-card p-3.5">
            <p className="text-[11px] text-ink-3">Paid all time</p>
            <p className="display text-xl tabular-nums"><Counter value={c?.earned ?? 0} formatter={(n) => fmtMoney(Math.round(n), currency)} /></p>
          </div>
          <div className="rounded-2xl bg-amber-soft p-3.5">
            <p className="text-[11px] text-ink-2">Pending payments</p>
            <p className="display text-xl tabular-nums"><Counter value={c?.pending_payments ?? 0} formatter={(n) => fmtMoney(Math.round(n), currency)} /></p>
          </div>
          <p className="text-[10px] text-ink-3">Amounts are the fees agreed with brands when you were hired, in each campaign&apos;s currency.</p>
        </div>
      </ChartCard>
    </div>
  );
}
