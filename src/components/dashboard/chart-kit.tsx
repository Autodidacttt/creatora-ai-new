"use client";

import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus, RefreshCw, Table2, LineChart as LineIcon } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn, compact } from "@/lib/utils";

// Validated categorical slots (see globals.css --chart-*); text never uses series colours.
export const SERIES = { primary: "var(--chart-1)", secondary: "var(--chart-2)", tertiary: "var(--chart-3)" } as const;

// A fixed locale keeps server-rendered and hydrated text identical (runtime default locales differ).
const LOCALE = "en-GB";
export const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(LOCALE, { ...opts, timeZone: "UTC" });
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${n.toFixed(digits)}%`);
export const fmtMoney = (n: number, currency: string) =>
  new Intl.NumberFormat(LOCALE, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

export function useChartAnimation() {
  const reduce = useReducedMotion();
  return { isAnimationActive: !reduce, animationDuration: 700, animationEasing: "ease-out" as const };
}

export const axisProps = {
  axisLine: false,
  tickLine: false,
  tick: { fill: "var(--ink-3)", fontSize: 11 },
} as const;

// ---------------------------------------------------------------------------
// Glass tooltip: value leads, series name follows, keyed with a short line in the series colour
// ---------------------------------------------------------------------------
export interface TipRow { key: string; label: string; value: string; color: string; dashed?: boolean }

export function GlassTip({ title, rows, footer }: { title: string; rows: TipRow[]; footer?: ReactNode }) {
  return (
    <div className="glass-strong min-w-40 rounded-2xl px-3.5 py-2.5 text-xs shadow-lift">
      <p className="mb-1.5 font-medium text-ink-2">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <svg width="14" height="4" aria-hidden><line x1="0" y1="2" x2="14" y2="2" stroke={r.color} strokeWidth="2" strokeDasharray={r.dashed ? "3 2" : undefined} /></svg>
            <span className="text-sm font-semibold tabular-nums text-ink">{r.value}</span>
            <span className="text-ink-3">{r.label}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="mt-1.5 border-t border-line pt-1.5 text-ink-3">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delta badge: arrow + signed % + text — never colour alone
// ---------------------------------------------------------------------------
export function DeltaBadge({ current, previous, mode = "percent", suffix = "vs previous period" }: {
  current: number | null | undefined;
  previous: number | null | undefined;
  mode?: "percent" | "points";
  suffix?: string;
}) {
  const cur = current ?? 0;
  const prev = previous ?? 0;
  let label: string;
  let dir: "up" | "down" | "flat";
  if (mode === "points") {
    const d = (current ?? 0) - (previous ?? 0);
    dir = Math.abs(d) < 0.05 ? "flat" : d > 0 ? "up" : "down";
    label = current == null || previous == null ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(1)} pts`;
  } else if (prev === 0) {
    dir = cur > 0 ? "up" : "flat";
    label = cur > 0 ? "New" : "—";
  } else {
    const pct = ((cur - prev) / prev) * 100;
    dir = Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down";
    label = `${pct > 0 ? "+" : ""}${Math.abs(pct) >= 100 ? Math.round(pct) : pct.toFixed(1)}%`;
  }
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        dir === "up" ? "bg-success/10 text-success" : dir === "down" ? "bg-danger/10 text-danger" : "bg-ink/5 text-ink-2",
      )}
      title={suffix}
    >
      <Icon className="size-3" aria-hidden />
      <span>{label}</span>
      <span className="sr-only">{dir === "up" ? "increase" : dir === "down" ? "decrease" : "no change"} {suffix}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (KPI cards) — a bare shape, values are in the card itself
// ---------------------------------------------------------------------------
export function Sparkline({ data, dataKey, id }: { data: Record<string, number | string | null>[]; dataKey: string; id: string }) {
  const anim = useChartAnimation();
  if (!data.length) return <div className="h-9" />;
  return (
    <div className="h-9" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES.primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={SERIES.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={SERIES.primary} strokeWidth={1.5} fill={`url(#spark-${id})`} connectNulls {...anim} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card shell with loading / error / empty states and an optional table view
// ---------------------------------------------------------------------------
export function ChartCard({
  title, subtitle, actions, isLoading, error, onRetry, isEmpty, empty, table, children, className, skeleton = "chart",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty?: boolean;
  empty?: ReactNode;
  table?: ReactNode;
  children: ReactNode;
  className?: string;
  skeleton?: "chart" | "list" | "bars";
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ type: "spring", stiffness: 220, damping: 28 }}
      className={cn("glass flex min-w-0 flex-col rounded-[1.75rem] p-4 transition-shadow duration-300 hover:shadow-lift sm:p-5", className)}
    >
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1 basis-44">
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-ink-3">{subtitle}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {actions}
          {table && !isLoading && !error && !isEmpty && (
            <button
              type="button"
              onClick={() => setView(view === "chart" ? "table" : "chart")}
              className="grid size-8 place-items-center rounded-full text-ink-2 hover:bg-ink/5"
              aria-label={view === "chart" ? "Show as table" : "Show as chart"}
              title={view === "chart" ? "Show as table" : "Show as chart"}
            >
              {view === "chart" ? <Table2 className="size-4" /> : <LineIcon className="size-4" />}
            </button>
          )}
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <CardSkeleton kind={skeleton} />
        ) : error ? (
          <div role="alert" className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-ink-2">
            <AlertTriangle className="size-5 text-danger" />
            <p>Couldn&apos;t load this.</p>
            {onRetry && (
              <button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-3 py-1.5 text-xs font-medium hover:bg-ink/10">
                <RefreshCw className="size-3" /> Retry
              </button>
            )}
          </div>
        ) : isEmpty ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-4 text-center text-sm text-ink-2">{empty}</div>
        ) : view === "table" && table ? (
          <div className="max-h-80 overflow-auto">{table}</div>
        ) : (
          children
        )}
      </div>
    </motion.section>
  );
}

export function CardSkeleton({ kind }: { kind: "chart" | "list" | "bars" }) {
  if (kind === "list") {
    return <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="flex items-center gap-3"><div className="size-10 animate-pulse rounded-xl bg-ink/[0.07]" /><div className="h-3 flex-1 animate-pulse rounded bg-ink/[0.07]" /></div>)}</div>;
  }
  if (kind === "bars") {
    return <div className="space-y-2.5" aria-busy="true">{[90, 70, 50, 35].map((w) => <div key={w} className="h-3 animate-pulse rounded-full bg-ink/[0.07]" style={{ width: `${w}%` }} />)}</div>;
  }
  return (
    <div className="flex h-56 items-end gap-1.5 px-1" aria-busy="true">
      {[40, 55, 45, 70, 60, 80, 65, 90, 75, 85, 70, 95].map((h, i) => (
        <div key={i} className="flex-1 animate-pulse rounded-t-md bg-ink/[0.06]" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/** Legend that doubles as series toggles (identity is never colour-only: the label is always shown). */
export function LegendToggles({ items, hidden, onToggle }: {
  items: { key: string; label: string; color: string; dashed?: boolean }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show or hide series">
      {items.map((it) => {
        const off = hidden.has(it.key);
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onToggle(it.key)}
            aria-pressed={!off}
            className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity",
              off ? "border-line opacity-50" : "border-line bg-card")}
          >
            <svg width="14" height="4" aria-hidden><line x1="0" y1="2" x2="14" y2="2" stroke={it.color} strokeWidth="2" strokeDasharray={it.dashed ? "3 2" : undefined} /></svg>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left text-xs tabular-nums">
      <thead className="sticky top-0 bg-glass-strong backdrop-blur">
        <tr>{head.map((h) => <th key={h} className="px-2 py-1.5 font-medium text-ink-3">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="px-2 py-1.5">{typeof c === "number" ? compact(c) : c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
