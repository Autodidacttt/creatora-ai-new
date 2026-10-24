"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Bot, CheckCircle2, Gauge, Loader2, MinusCircle, Palette, RefreshCw, Ruler, ScanEye, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { AiReviewRow } from "@/types/workspace";
import type { CheckStatus, ColourCheck, DisclosureCheck, Estimate, ReviewCheck } from "@/lib/review/ai-review";
import { rerunAiReview } from "@/services/workspace";
import { Button } from "@/components/ui/button";
import { cn, errorMessage, timeAgo } from "@/lib/utils";
import { ExpandableCard } from "./expandable";
import { Swatch } from "./guideline-summary";

const STATUS: Record<CheckStatus, { icon: ReactNode; label: string; className: string }> = {
  pass: { icon: <CheckCircle2 />, label: "Pass", className: "text-success" },
  warn: { icon: <AlertTriangle />, label: "Check", className: "text-amber-ink" },
  fail: { icon: <XCircle />, label: "Fail", className: "text-danger" },
  na: { icon: <MinusCircle />, label: "N/A", className: "text-ink-3" },
};

function MatchRing({ score }: { score: number | null }) {
  const size = 56, r = 23, c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid shrink-0" style={{ width: size, height: size }} role="img" aria-label={score == null ? "No brand match score" : `Brand match ${score} out of 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-ink/10" />
        {score != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--amber-2)" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * score) / 100} className="transition-all duration-1000" />}
      </svg>
      <span className="display absolute inset-0 grid place-items-center text-base tabular-nums">{score ?? "—"}</span>
    </span>
  );
}

function MethodTag({ method }: { method: ReviewCheck["method"] }) {
  const m = { ai_assisted: { label: "AI-assisted", icon: <Bot className="size-3" /> }, deterministic: { label: "Measured", icon: <Ruler className="size-3" /> }, declaration: { label: "Declaration", icon: <ScanEye className="size-3" /> } }[method];
  return <span className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-2">{m.icon}{m.label}</span>;
}

function CheckRow({ name, check, extra }: { name: string; check: ReviewCheck | undefined; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!check) return null;
  const s = STATUS[check.status];
  return (
    <li className="rounded-2xl bg-card/70 p-3">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 [&_svg]:size-4", s.className)} aria-hidden>{s.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {name}<span className={cn("text-xs font-semibold", s.className)}>{s.label}</span><MethodTag method={check.method} />
          </p>
          <p className="mt-0.5 text-xs text-ink-2">{check.explanation}</p>
          {extra}
          {check.evidence.length > 0 && (
            <>
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 text-[11px] font-medium text-ink-3 underline-offset-2 hover:underline">
                {open ? "Hide evidence" : `Evidence (${check.evidence.length})`}
              </button>
              {open && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-ink-2">{check.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function EstimateRow({ name, e, level }: { name: string; e: Estimate | null | undefined; level?: string }) {
  if (!e) return null;
  return (
    <li className="rounded-2xl bg-card/70 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {name}<span className="rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-semibold capitalize">{level ?? e.rating}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Estimate</span>
      </p>
      <p className="mt-0.5 text-xs text-ink-2">{e.explanation}</p>
      {e.based_on.length > 0 && <p className="mt-1 text-[11px] text-ink-3">Based on: {e.based_on.join(" · ")}</p>}
    </li>
  );
}

/** Background AI review for a submission, shown as expandable cards. */
export function AiReviewPanel({ submissionId, ai, onRetry }: { submissionId: string; ai: AiReviewRow | null; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (ai?.status !== "running") return;
    const age = Date.now() - new Date(ai.updated_at).getTime();
    const t = setTimeout(() => setStale(true), Math.max(0, 150_000 - age));
    return () => clearTimeout(t);
  }, [ai?.status, ai?.updated_at]);
  const retry = async () => {
    setBusy(true);
    try { await rerunAiReview(submissionId); toast.success("Re-running the analysis"); onRetry(); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };

  if (!ai || ai.status === "pending" || ai.status === "running") {
    return (
      <div className="glass flex items-center gap-3 rounded-[1.75rem] p-4" role="status">
        <Loader2 className="size-5 animate-spin text-amber-ink" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Analysing this submission…</p>
          <p className="text-xs text-ink-2">Measuring colours and format, and asking the AI to check logo, style and typography. Usually under a minute.</p>
        </div>
        {ai?.status === "running" && stale && (
          <Button size="sm" onClick={retry} loading={busy}><RefreshCw /> Retry</Button>
        )}
      </div>
    );
  }

  const c = ai.checks;
  const colors = c.colors as ColourCheck | undefined;
  const disc = c.ai_disclosure as DisclosureCheck | undefined;
  const ins = ai.insights;
  return (
    <div className="space-y-3">
      {ai.status === "failed" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[1.5rem] border border-danger/20 bg-danger/5 p-3.5 text-sm">
          <AlertTriangle className="size-4 text-danger" aria-hidden />
          <span className="min-w-0 flex-1">AI analysis failed{ai.error ? `: ${ai.error}` : ""}. Measured checks below are still valid.</span>
          <Button size="sm" onClick={retry} loading={busy}><RefreshCw /> Retry</Button>
        </div>
      )}
      <ExpandableCard defaultOpen icon={<Palette />} title="Brand match"
        subtitle="Score comes from the checklist only: pass 100 · check 50 · fail 0, averaged over the checks that apply."
        aside={<MatchRing score={ai.brand_match_score} />}>
        <ul className="space-y-2">
          <CheckRow name="Logo" check={c.logo} />
          <CheckRow name="Colours" check={colors} extra={colors && colors.matches.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {colors.matches.map((m) => (
                <span key={m.brand} className="flex items-center gap-1.5 text-[11px]">
                  <Swatch hex={m.brand} size="sm" /> <span className="text-ink-3">→</span> {m.closest ? <Swatch hex={m.closest} size="sm" /> : <span className="text-ink-3">none</span>}
                  {m.delta != null && <span className={m.matched ? "text-success" : "text-ink-3"}>ΔE {m.delta}</span>}
                </span>
              ))}
            </div>
          ) : null} />
          <CheckRow name="Visual style" check={c.visual_style} />
          <CheckRow name="Typography" check={c.typography} />
        </ul>
      </ExpandableCard>
      <ExpandableCard icon={<ScanEye />} title="AI-generated content check"
        subtitle={disc ? `Declared: ${disc.declared ? "yes" : "no"} · Brief requires disclosure: ${disc.required ? "yes" : "no"} · Requirement ${disc.status === "fail" ? "not met" : disc.status === "na" ? "n/a" : "met"}` : "Not available"}>
        {disc && (
          <div className="space-y-2">
            <ul><CheckRow name="Disclosure" check={disc} /></ul>
            {disc.tools_in_brief.length > 0 && <p className="text-xs text-ink-2">Tools named in the brief: {disc.tools_in_brief.join(", ")}</p>}
            <p className="text-[11px] text-ink-3">Creatora doesn&apos;t claim to detect AI content. This compares what the creator declared with what the brief requires.</p>
          </div>
        )}
      </ExpandableCard>
      <ExpandableCard icon={<Gauge />} title="Creative insights" subtitle="Hook, pacing and a retention estimate — predictions, not measured results">
        {ins?.hook || ins?.pacing || ins?.retention ? (
          <div className="space-y-2">
            <ul className="space-y-2">
              <EstimateRow name="Hook" e={ins.hook} />
              <EstimateRow name="Pacing" e={ins.pacing} />
              {ins.retention && <EstimateRow name="Retention" e={{ rating: "ok", explanation: ins.retention.explanation, based_on: ins.retention.based_on }} level={ins.retention.level} />}
            </ul>
            <ul><CheckRow name="Format" check={c.format} /></ul>
            <p className="text-[11px] text-ink-3">Estimates are AI-assisted judgements from sampled frames and file metadata. They aren&apos;t performance data.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-2">{ins?.unavailable_reason ?? "Not available for this submission."}</p>
            <ul><CheckRow name="Format" check={c.format} /></ul>
          </div>
        )}
      </ExpandableCard>
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
        <Sparkles className="size-3" aria-hidden />
        {ai.model_name ? `AI-assisted checks by ${ai.model_name}` : "AI-assisted checks unavailable"} · colours & format measured deterministically · updated {timeAgo(ai.updated_at)}
        <button type="button" onClick={retry} disabled={busy} className="ml-1 underline-offset-2 hover:underline">Re-run</button>
      </p>
    </div>
  );
}
