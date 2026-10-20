"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Save, Send } from "lucide-react";
import { toast } from "sonner";
import type { AspectRatio, CampaignCard } from "@/types/app";
import { useDb } from "@/features/session";
import { useLookups } from "@/hooks/use-lookups";
import { campaignSchema, type CampaignInput } from "@/lib/validation/schemas";
import { createCampaign, updateCampaign } from "@/services/campaigns";
import { ASPECT_RATIOS, CURRENCIES, EXCLUSIVITY, LICENSE_TYPES, USAGE_DURATIONS, USAGE_RIGHTS } from "@/config/constants";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { ToggleChip } from "@/components/ui/chip";
import { Switch } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { PillCTA } from "@/components/ui/pill-cta";
import { GlassPanel } from "@/components/ui/glass";
import { Skeleton } from "@/components/ui/states";
import { errorMessage } from "@/lib/utils";
import { BriefBuilder, type AIDraft } from "./brief-builder";

interface FormState {
  title: string;
  description: string;
  deliverables: string;
  content_type_id: number | null;
  style_id: number | null;
  category_id: number | null;
  aspect_ratios: AspectRatio[];
  custom_aspect: string;
  target_audience: string;
  budget_min: string;
  budget_max: string;
  currency: string;
  deadline: string;
  creators_needed: string;
  usage_rights: string[];
  territory: string;
  usage_duration: string;
  exclusivity: string;
  license_type: string;
  ai_disclosure_required: boolean;
  ai_assisted: boolean;
  platform_ids: number[];
  tool_ids: number[];
  skill_ids: number[];
  language_ids: number[];
}

function fromCampaign(c?: CampaignCard): FormState {
  return {
    title: c?.title ?? "",
    description: c?.description ?? "",
    deliverables: c?.deliverables ?? "",
    content_type_id: c?.content_type_id ?? null,
    style_id: c?.style_id ?? null,
    category_id: c?.category_id ?? null,
    aspect_ratios: c?.aspect_ratios ?? [],
    custom_aspect: c?.custom_aspect ?? "",
    target_audience: c?.target_audience ?? "",
    budget_min: c?.budget_min?.toString() ?? "",
    budget_max: c?.budget_max?.toString() ?? "",
    currency: c?.currency ?? "USD",
    deadline: c?.deadline ?? "",
    creators_needed: c?.creators_needed?.toString() ?? "1",
    usage_rights: c?.usage_rights ?? [],
    territory: c?.territory ?? "Worldwide",
    usage_duration: c?.usage_duration ?? "12_months",
    exclusivity: c?.exclusivity ?? "none",
    license_type: c?.license_type ?? "non_exclusive",
    ai_disclosure_required: c?.ai_disclosure_required ?? true,
    ai_assisted: c?.ai_assisted ?? false,
    platform_ids: c?.platforms.map((x) => x.id) ?? [],
    tool_ids: c?.tools.map((x) => x.id) ?? [],
    skill_ids: c?.skills.map((x) => x.id) ?? [],
    language_ids: c?.languages.map((x) => x.id) ?? [],
  };
}

function Section({ n, title, children, highlight }: { n: number; title: string; children: React.ReactNode; highlight: number }) {
  return (
    <GlassPanel className="space-y-4 p-5 sm:p-7">
      <motion.div key={highlight} initial={highlight ? { backgroundColor: "rgba(255,192,46,0.35)" } : false} animate={{ backgroundColor: "rgba(255,192,46,0)" }}
        transition={{ duration: 1.6 }} className="-mx-2 -mt-2 flex items-center gap-3 rounded-2xl px-2 py-2">
        <span className="grid size-8 place-items-center rounded-full bg-amber text-sm font-bold text-on-amber">{n}</span>
        <h2 className="display text-lg">{title}</h2>
      </motion.div>
      {children}
    </GlassPanel>
  );
}

export function CampaignForm({ campaign }: { campaign?: CampaignCard }) {
  const db = useDb();
  const router = useRouter();
  const qc = useQueryClient();
  const lookups = useLookups();
  const [v, setV] = useState<FormState>(() => fromCampaign(campaign));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<"draft" | "active" | null>(null);
  const [aiTick, setAiTick] = useState(0);
  const set = <K extends keyof FormState>(k: K, value: FormState[K]) => setV((s) => ({ ...s, [k]: value }));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  function applyDraft(d: AIDraft) {
    setV((s) => ({
      ...s,
      title: d.title,
      description: d.description,
      deliverables: d.deliverables,
      target_audience: d.target_audience,
      content_type_id: d.content_type_id,
      style_id: d.style_id,
      category_id: d.category_id,
      aspect_ratios: d.aspect_ratios as AspectRatio[],
      platform_ids: d.platform_ids,
      tool_ids: d.tool_ids,
      skill_ids: d.skill_ids,
      language_ids: d.language_ids,
      budget_min: d.budget_min?.toString() ?? "",
      budget_max: d.budget_max?.toString() ?? "",
      currency: d.currency,
      deadline: d.deadline ?? "",
      creators_needed: String(d.creators_needed),
      usage_rights: d.usage_rights,
      territory: d.territory,
      usage_duration: d.usage_duration,
      exclusivity: d.exclusivity,
      license_type: d.license_type,
      ai_disclosure_required: d.ai_disclosure_required,
      ai_assisted: true,
    }));
    setErrors({});
    setAiTick((t) => t + 1);
    toast.success("Brief drafted — review and edit before saving");
  }

  async function save(status: "draft" | "active") {
    const num = (s: string) => (s.trim() === "" ? null : s);
    const parsed = campaignSchema.safeParse({
      ...v,
      budget_min: num(v.budget_min),
      budget_max: num(v.budget_max),
      deadline: v.deadline || null,
      status: campaign?.status === "completed" ? "completed" : status,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Some fields need attention");
      return;
    }
    setErrors({});
    setSaving(status);
    try {
      const input: CampaignInput = parsed.data;
      const id = campaign ? (await updateCampaign(db, campaign.id, input), campaign.id) : await createCampaign(db, input);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["campaign", id] });
      toast.success(status === "active" ? "Brief published — here are your best matches" : "Draft saved");
      router.push(`/campaigns/${id}${status === "active" ? "?tab=matches" : ""}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(null);
    }
  }

  if (lookups.isPending) return <Skeleton className="h-[50rem] rounded-[2rem]" />;
  const L = lookups.data;
  if (!L) return <p className="text-danger">Couldn&apos;t load form options. Refresh to try again.</p>;
  const o = (xs: { id: number; name: string }[]) => xs.map((x) => ({ value: x.id, label: x.name }));

  return (
    <div className="space-y-5">
      {!campaign && <BriefBuilder onDraft={applyDraft} />}

      <Section n={1} title="The brief" highlight={aiTick}>
        <Field label="Title" htmlFor="title" error={errors.title}>
          <Input id="title" maxLength={140} value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. SS27 drop: cinematic AI lookbook for Gen Z" />
        </Field>
        <Field label="Description" htmlFor="description" error={errors.description} hint="Goal, concept, tone and must-haves — written for creators">
          <Textarea id="description" rows={5} maxLength={4000} value={v.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label="Deliverables" htmlFor="deliverables" optional>
          <Textarea id="deliverables" rows={2} maxLength={2000} value={v.deliverables} onChange={(e) => set("deliverables", e.target.value)} placeholder="e.g. 6 hero stills (4:5), 3 vertical videos (9:16, 6–12s)" />
        </Field>
      </Section>

      <Section n={2} title="Creative direction & format" highlight={aiTick}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Content type" htmlFor="ct">
            <Select id="ct" value={v.content_type_id ?? ""} onChange={(e) => set("content_type_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any</option>{L.content_types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Style / genre" htmlFor="style">
            <Select id="style" value={v.style_id ?? ""} onChange={(e) => set("style_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any</option>{L.styles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Category" htmlFor="cat">
            <Select id="cat" value={v.category_id ?? ""} onChange={(e) => set("category_id", e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any</option>{L.categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Format / aspect ratio" error={errors.aspect_ratios}>
          <div className="flex flex-wrap gap-2">
            {ASPECT_RATIOS.map((a) => (
              <ToggleChip key={a.value} selected={v.aspect_ratios.includes(a.value)} onClick={() => set("aspect_ratios", toggle(v.aspect_ratios, a.value))}>
                <span className="font-semibold">{a.label}</span> <span className="text-xs opacity-70">{a.hint.split("·")[1] ?? ""}</span>
              </ToggleChip>
            ))}
          </div>
        </Field>
        {v.aspect_ratios.includes("custom") && (
          <Field label="Custom format" htmlFor="custom" error={errors.custom_aspect}>
            <Input id="custom" maxLength={40} value={v.custom_aspect} onChange={(e) => set("custom_aspect", e.target.value)} placeholder="e.g. 3:1 billboard, 1080×1350" />
          </Field>
        )}
        <Field label="Platforms">
          <MultiSelect label="Platforms" options={o(L.platforms)} value={v.platform_ids} onChange={(x) => set("platform_ids", x)} placeholder="Where will it run?" />
        </Field>
      </Section>

      <Section n={3} title="Creator requirements" highlight={aiTick}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Required AI tools" hint="Used for matching — not a hard filter">
            <MultiSelect label="Tools" options={L.ai_tools.map((t) => ({ value: t.id, label: t.name, group: t.category }))} value={v.tool_ids} onChange={(x) => set("tool_ids", x)} />
          </Field>
          <Field label="Required skills">
            <MultiSelect label="Skills" options={o(L.skills)} value={v.skill_ids} onChange={(x) => set("skill_ids", x)} />
          </Field>
          <Field label="Languages">
            <MultiSelect label="Languages" options={o(L.languages)} value={v.language_ids} onChange={(x) => set("language_ids", x)} />
          </Field>
          <Field label="Creators needed" htmlFor="n" error={errors.creators_needed}>
            <Input id="n" type="number" min={1} max={50} value={v.creators_needed} onChange={(e) => set("creators_needed", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section n={4} title="Audience, budget & timing" highlight={aiTick}>
        <Field label="Target audience" htmlFor="aud" optional>
          <Input id="aud" maxLength={500} value={v.target_audience} onChange={(e) => set("target_audience", e.target.value)} placeholder="e.g. Gen Z (18–26) in FR, UK, ES who follow fashion creators" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Budget from" htmlFor="bmin" error={errors.budget_min} optional>
            <Input id="bmin" inputMode="numeric" value={v.budget_min} onChange={(e) => set("budget_min", e.target.value)} />
          </Field>
          <Field label="Budget to" htmlFor="bmax" error={errors.budget_max} optional>
            <Input id="bmax" inputMode="numeric" value={v.budget_max} onChange={(e) => set("budget_max", e.target.value)} />
          </Field>
          <Field label="Currency" htmlFor="cur">
            <Select id="cur" value={v.currency} onChange={(e) => set("currency", e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Deadline" htmlFor="deadline" optional>
            <Input id="deadline" type="date" value={v.deadline} onChange={(e) => set("deadline", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section n={5} title="Commercial use & rights" highlight={aiTick}>
        <Field label="Usage rights" error={errors.usage_rights}>
          <div className="flex flex-wrap gap-2">
            {USAGE_RIGHTS.map((u) => (
              <ToggleChip key={u.value} selected={v.usage_rights.includes(u.value)} onClick={() => set("usage_rights", toggle(v.usage_rights, u.value))}>{u.label}</ToggleChip>
            ))}
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Territory" htmlFor="territory" error={errors.territory}>
            <Input id="territory" maxLength={80} value={v.territory} onChange={(e) => set("territory", e.target.value)} />
          </Field>
          <Field label="Usage duration" htmlFor="duration">
            <Select id="duration" value={v.usage_duration} onChange={(e) => set("usage_duration", e.target.value)}>
              {USAGE_DURATIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </Select>
          </Field>
          <Field label="Exclusivity" htmlFor="excl">
            <Select id="excl" value={v.exclusivity} onChange={(e) => set("exclusivity", e.target.value)}>
              {EXCLUSIVITY.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </Select>
          </Field>
          <Field label="Licence type" htmlFor="lic">
            <Select id="lic" value={v.license_type} onChange={(e) => set("license_type", e.target.value)}>
              {LICENSE_TYPES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </Select>
          </Field>
        </div>
        <label className="flex items-start justify-between gap-4 rounded-2xl bg-card p-4">
          <span>
            <span className="block text-sm font-medium">Require AI disclosure</span>
            <span className="block text-xs text-ink-3">Deliverables must be labelled as AI-generated where platforms or regulations require it.</span>
          </span>
          <Switch checked={v.ai_disclosure_required} onCheckedChange={(x) => set("ai_disclosure_required", x)} label="Require AI disclosure" />
        </label>
      </Section>

      <div className="glass-strong sticky bottom-24 z-20 flex flex-wrap items-center justify-end gap-2 rounded-full p-2 lg:bottom-4">
        {campaign?.status !== "active" && campaign?.status !== "completed" && (
          <Button onClick={() => save("draft")} loading={saving === "draft"} disabled={!!saving}><Save /> Save draft</Button>
        )}
        <PillCTA onClick={() => save(campaign?.status === "completed" ? "draft" : "active")} loading={saving === "active"} disabled={!!saving}>
          <span className="flex items-center gap-2"><Send className="size-4" /> {campaign?.status === "active" ? "Save changes" : campaign?.status === "completed" ? "Save" : "Publish brief"}</span>
        </PillCTA>
      </div>
    </div>
  );
}
