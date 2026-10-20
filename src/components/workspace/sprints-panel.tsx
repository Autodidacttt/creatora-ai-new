"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSearch, Users, Zap } from "lucide-react";
import { toast } from "sonner";
import { CURRENCIES } from "@/config/constants";
import { useDb } from "@/features/session";
import { createSprint, getBrandSprints } from "@/services/workspace";
import { sprintSchema, STUDIO_ASPECTS } from "@/lib/validation/workspace";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ToggleChip } from "@/components/ui/chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { PillCTA } from "@/components/ui/pill-cta";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { errorMessage } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { Countdown } from "./countdown";
import { ExpandableCard } from "./expandable";

function SprintForm({ onCreated }: { onCreated: (id: string) => void }) {
  const db = useDb();
  const [v, setV] = useState({ title: "", description: "", deliverables: "", budget: "", currency: "USD", hours: "48", aspect_ratios: ["9:16"] as string[] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, val: string | string[]) => setV((x) => ({ ...x, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = sprintSchema.safeParse(v);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const id = await createSprint(db, parsed.data);
      toast.success("Sprint is live — the clock is running");
      setV({ title: "", description: "", deliverables: "", budget: "", currency: v.currency, hours: "48", aspect_ratios: ["9:16"] });
      onCreated(id);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="What do you need?" htmlFor="sp-title" error={errors.title}>
        <Input id="sp-title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={140} placeholder="e.g. 3 vertical teaser loops for our Friday drop" />
      </Field>
      <Field label="Brief" htmlFor="sp-desc" error={errors.description}>
        <Textarea id="sp-desc" value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} placeholder="Concept, mood, must-haves, what to avoid." />
      </Field>
      <Field label="Deliverables" htmlFor="sp-del" optional>
        <Input id="sp-del" value={v.deliverables} onChange={(e) => set("deliverables", e.target.value)} maxLength={1000} placeholder="e.g. 3 × 8s loops, 9:16, no audio" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_7rem_8rem]">
        <Field label="Fixed budget" htmlFor="sp-budget" error={errors.budget}>
          <Input id="sp-budget" inputMode="numeric" value={v.budget} onChange={(e) => set("budget", e.target.value.replace(/[^0-9]/g, ""))} placeholder="800" />
        </Field>
        <Field label="Currency" htmlFor="sp-cur">
          <Select id="sp-cur" value={v.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Window" htmlFor="sp-hours">
          <Select id="sp-hours" value={v.hours} onChange={(e) => set("hours", e.target.value)}>
            {["24", "48", "72"].map((h) => <option key={h} value={h}>{h} hours</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Formats" error={errors.aspect_ratios}>
        <div className="flex flex-wrap gap-2">
          {STUDIO_ASPECTS.map((a) => (
            <ToggleChip key={a} selected={v.aspect_ratios.includes(a)} onClick={() => set("aspect_ratios", v.aspect_ratios.includes(a) ? v.aspect_ratios.filter((x) => x !== a) : [...v.aspect_ratios, a])}>{a}</ToggleChip>
          ))}
        </div>
      </Field>
      <p className="text-xs text-ink-3">Creators apply and can submit spec work right away. Submissions close automatically at the deadline — late ones are rejected by the server.</p>
      <div className="flex justify-end"><PillCTA type="submit" loading={busy}>Launch sprint</PillCTA></div>
    </form>
  );
}

export function SprintsPanel({ onOpenCandidates }: { onOpenCandidates: (campaignId: string) => void }) {
  const db = useDb();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["hiring", "sprints"], queryFn: () => getBrandSprints(db), refetchInterval: 30_000 });
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="space-y-4">
      <ExpandableCard key={formKey} icon={<Zap />} title="Post a 48-hour creative sprint" subtitle="An urgent micro-campaign with a fixed budget and a hard deadline" defaultOpen={q.isSuccess && q.data.length === 0}>
        <SprintForm onCreated={() => { setFormKey((k) => k + 1); qc.invalidateQueries({ queryKey: ["hiring"] }); qc.invalidateQueries({ queryKey: ["brand-overview"] }); qc.invalidateQueries({ queryKey: ["campaigns"] }); }} />
      </ExpandableCard>
      {q.isPending && <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-[1.75rem]" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && q.data.length === 0 && <EmptyState icon={<Zap />} title="No sprints yet" description="Need something fast? Post a sprint above — creators see it in Opportunities immediately." />}
      <div className="grid gap-4 md:grid-cols-2">
        {q.data?.map((s) => (
          <article key={s.id} className="glass space-y-3 rounded-[1.75rem] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{s.title}</p>
                <p className="line-clamp-2 text-xs text-ink-2">{s.description}</p>
              </div>
              <Countdown to={s.sprint_deadline} compact />
            </div>
            <dl className="grid grid-cols-4 gap-2 text-center">
              {[["Budget", formatMoney(s.budget_max ?? s.budget_min, s.currency)], ["Entrants", s.entrants], ["Submitted", s.submissions], ["Hired", s.hired]].map(([k, val]) => (
                <div key={String(k)} className="rounded-2xl bg-card/70 px-1 py-2">
                  <dt className="text-[10px] text-ink-3">{k}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{val}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => onOpenCandidates(s.id)}><Users /> Candidates</Button>
              <Link href={`/brand/campaigns/review?campaign=${s.id}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                <FileSearch /> Review{s.pending_review ? ` (${s.pending_review})` : ""}
              </Link>
              <Link href={`/campaigns/${s.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>Brief</Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
