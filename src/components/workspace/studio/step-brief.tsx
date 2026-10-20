"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Camera, ClipboardList, Coins, FileText, RefreshCw, Scale, Wand2, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { Lookups } from "@/types/app";
import { CURRENCIES, EXCLUSIVITY, LICENSE_TYPES, USAGE_DURATIONS, USAGE_RIGHTS } from "@/config/constants";
import { SECTION_FIELDS, STUDIO_ASPECTS, type BriefSection, type StudioBrief } from "@/lib/validation/workspace";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Switch } from "@/components/ui/misc";
import { errorMessage } from "@/lib/utils";
import { ListEditor } from "./list-editor";

export async function requestBrief(body: { idea: string; link_summary: string | null; section?: BriefSection; current?: StudioBrief }) {
  const res = await fetch("/api/studio/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { brief?: StudioBrief; model?: string; error?: string; code?: string };
  if (!res.ok || !json.brief) {
    const err = new Error(json.error ?? "The AI couldn't write this brief") as Error & { code?: string };
    err.code = json.code;
    throw err;
  }
  return { brief: json.brief, model: json.model ?? null };
}

function Section({ title, icon, section, onRegenerate, busy, children }: {
  title: string;
  icon: ReactNode;
  section: BriefSection;
  onRegenerate: (s: BriefSection) => void;
  busy: BriefSection | null;
  children: ReactNode;
}) {
  return (
    <section className="glass space-y-4 rounded-[1.75rem] p-5" aria-label={title}>
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-amber-soft [&_svg]:size-4">{icon}</span>
        <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        <Button size="sm" variant="ghost" loading={busy === section} disabled={!!busy} onClick={() => onRegenerate(section)}><RefreshCw /> Regenerate</Button>
      </div>
      {children}
    </section>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const num = (s: string) => (s.trim() === "" ? null : Math.max(0, parseInt(s.replace(/[^0-9]/g, ""), 10) || 0));

/** Step 2: every field of the AI brief is editable inline; each section can be regenerated on its own. */
export function StepBrief({ brief, onChange, lookups, idea, linkSummary, aiNote }: {
  brief: StudioBrief;
  onChange: (b: StudioBrief) => void;
  lookups: Lookups | undefined;
  idea: string;
  linkSummary: string | null;
  aiNote: string | null;
}) {
  const [busy, setBusy] = useState<BriefSection | null>(null);
  const set = <K extends keyof StudioBrief>(k: K, v: StudioBrief[K]) => onChange({ ...brief, [k]: v });

  async function regenerate(section: BriefSection) {
    setBusy(section);
    try {
      const { brief: fresh } = await requestBrief({ idea, link_summary: linkSummary, section, current: brief });
      const next = { ...brief };
      for (const k of SECTION_FIELDS[section]) (next as Record<string, unknown>)[k] = fresh[k];
      onChange(next);
      toast.success("Section regenerated");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const names = (k: keyof Lookups) => lookups?.[k].map((x) => x.name) ?? [];
  return (
    <div className="space-y-4">
      {aiNote && (
        <p role="status" className="flex items-start gap-2 rounded-2xl bg-amber-soft/70 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {aiNote}
        </p>
      )}
      <Section title="Overview" icon={<FileText />} section="overview" onRegenerate={regenerate} busy={busy}>
        <Field label="Title" htmlFor="b-title"><Input id="b-title" value={brief.title} maxLength={140} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Objective" htmlFor="b-obj"><Textarea id="b-obj" value={brief.objective} maxLength={600} className="min-h-16" onChange={(e) => set("objective", e.target.value)} /></Field>
        <Field label="Concept for creators" htmlFor="b-sum"><Textarea id="b-sum" rows={5} value={brief.summary} maxLength={2000} onChange={(e) => set("summary", e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Audience" htmlFor="b-aud"><Input id="b-aud" value={brief.audience} maxLength={500} onChange={(e) => set("audience", e.target.value)} /></Field>
          <Field label="Tone" htmlFor="b-tone"><Input id="b-tone" value={brief.tone} maxLength={300} onChange={(e) => set("tone", e.target.value)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {([["content_type", "Content type", "content_types"], ["style", "Style", "styles"], ["category", "Category", "categories"]] as const).map(([k, label, lk]) => (
            <Field key={k} label={label} htmlFor={`b-${k}`}>
              <Select id={`b-${k}`} value={brief[k] ?? ""} onChange={(e) => set(k, e.target.value || null)}>
                <option value="">—</option>
                {names(lk).map((n) => <option key={n}>{n}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Deliverables, platforms & format" icon={<ClipboardList />} section="deliverables" onRegenerate={regenerate} busy={busy}>
        <Field label="Deliverables"><ListEditor label="Deliverable" value={brief.deliverables} onChange={(v) => set("deliverables", v)} placeholder="e.g. 3 × 15s vertical videos" /></Field>
        <Field label="Platforms">
          <div className="flex flex-wrap gap-2">{names("platforms").map((p) => <ToggleChip key={p} selected={brief.platforms.includes(p)} onClick={() => set("platforms", toggle(brief.platforms, p))}>{p}</ToggleChip>)}</div>
        </Field>
        <Field label="Formats">
          <div className="flex flex-wrap gap-2">{STUDIO_ASPECTS.map((a) => <ToggleChip key={a} selected={brief.aspect_ratios.includes(a)} onClick={() => set("aspect_ratios", toggle(brief.aspect_ratios, a))}>{a}</ToggleChip>)}</div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem_9rem]">
          <Field label="Timeline" htmlFor="b-tl"><Input id="b-tl" value={brief.timeline} maxLength={300} onChange={(e) => set("timeline", e.target.value)} /></Field>
          <Field label="Days to deliver" htmlFor="b-days"><Input id="b-days" inputMode="numeric" value={brief.deadline_days ?? ""} onChange={(e) => set("deadline_days", num(e.target.value) ? Math.min(365, num(e.target.value)!) : null)} /></Field>
          <Field label="Creators" htmlFor="b-cn"><Input id="b-cn" inputMode="numeric" value={brief.creators_needed} onChange={(e) => set("creators_needed", Math.min(50, Math.max(1, num(e.target.value) ?? 1)))} /></Field>
        </div>
      </Section>

      <Section title="Budget guidance" icon={<Coins />} section="budget" onRegenerate={regenerate} busy={busy}>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem]">
          <Field label="Min" htmlFor="b-min"><Input id="b-min" inputMode="numeric" value={brief.budget.min ?? ""} onChange={(e) => set("budget", { ...brief.budget, min: num(e.target.value) })} /></Field>
          <Field label="Max" htmlFor="b-max"><Input id="b-max" inputMode="numeric" value={brief.budget.max ?? ""} onChange={(e) => set("budget", { ...brief.budget, max: num(e.target.value) })} /></Field>
          <Field label="Currency" htmlFor="b-cur">
            <Select id="b-cur" value={brief.budget.currency} onChange={(e) => set("budget", { ...brief.budget, currency: e.target.value as StudioBrief["budget"]["currency"] })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        </div>
        <Field label="Why this range" htmlFor="b-bg" hint="AI budget guidance is a rough market guide, not a quote."><Textarea id="b-bg" value={brief.budget.guidance} maxLength={400} className="min-h-16" onChange={(e) => set("budget", { ...brief.budget, guidance: e.target.value })} /></Field>
      </Section>

      <Section title="Requirements" icon={<ClipboardList />} section="requirements" onRegenerate={regenerate} busy={busy}>
        <ListEditor label="Requirement" value={brief.requirements} onChange={(v) => set("requirements", v)} placeholder="e.g. Use our product renders for the hero shot" />
      </Section>

      <Section title="Suggested AI tools & models" icon={<Wrench />} section="tools" onRegenerate={regenerate} busy={busy}>
        <ListEditor label="Tool" max={10} value={brief.suggested_tools} onChange={(v) => set("suggested_tools", v)} placeholder="e.g. Runway Gen-4" />
        <p className="text-xs text-ink-3">Tools that match our catalogue also power creator matching.</p>
      </Section>

      <Section title="Camera, lighting, style & format" icon={<Camera />} section="production" onRegenerate={regenerate} busy={busy}>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["camera", "lighting", "style", "format"] as const).map((k) => (
            <Field key={k} label={k[0].toUpperCase() + k.slice(1)} htmlFor={`b-p-${k}`}>
              <Textarea id={`b-p-${k}`} value={brief.production[k]} maxLength={400} className="min-h-20" onChange={(e) => set("production", { ...brief.production, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="Commercial use & IP" icon={<Scale />} section="ip" onRegenerate={regenerate} busy={busy}>
        <Field label="Usage rights">
          <div className="flex flex-wrap gap-2">{USAGE_RIGHTS.map((u) => <ToggleChip key={u.value} selected={brief.ip.usage_rights.includes(u.value)} onClick={() => set("ip", { ...brief.ip, usage_rights: toggle(brief.ip.usage_rights, u.value) })}>{u.label}</ToggleChip>)}</div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Territory" htmlFor="b-ter"><Input id="b-ter" value={brief.ip.territory} maxLength={80} onChange={(e) => set("ip", { ...brief.ip, territory: e.target.value })} /></Field>
          <Field label="Duration" htmlFor="b-dur"><Select id="b-dur" value={brief.ip.usage_duration} onChange={(e) => set("ip", { ...brief.ip, usage_duration: e.target.value as StudioBrief["ip"]["usage_duration"] })}>{USAGE_DURATIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</Select></Field>
          <Field label="Exclusivity" htmlFor="b-exc"><Select id="b-exc" value={brief.ip.exclusivity} onChange={(e) => set("ip", { ...brief.ip, exclusivity: e.target.value as StudioBrief["ip"]["exclusivity"] })}>{EXCLUSIVITY.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</Select></Field>
          <Field label="Licence" htmlFor="b-lic"><Select id="b-lic" value={brief.ip.license_type} onChange={(e) => set("ip", { ...brief.ip, license_type: e.target.value as StudioBrief["ip"]["license_type"] })}>{LICENSE_TYPES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</Select></Field>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={brief.ip.ai_disclosure_required} onCheckedChange={(v) => set("ip", { ...brief.ip, ai_disclosure_required: v })} label="AI disclosure required" />
          Creators must disclose AI use when the work is published
        </label>
        <Field label="Other IP terms" htmlFor="b-ipn" optional><Textarea id="b-ipn" value={brief.ip.notes} maxLength={600} className="min-h-16" onChange={(e) => set("ip", { ...brief.ip, notes: e.target.value })} /></Field>
      </Section>
      <p className="flex items-center gap-1.5 text-[11px] text-ink-3"><Wand2 className="size-3" /> AI-drafted. Review every section — you&apos;re publishing this to real creators.</p>
    </div>
  );
}
