"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { FullProfile } from "@/types/app";
import { useDb } from "@/features/session";
import { useLookups } from "@/hooks/use-lookups";
import { creatorDetailsSchema, experienceSchema, brandDetailsSchema } from "@/lib/validation/schemas";
import { addExperience, deleteExperience, setCreatorAttributes, updateBrandDetails, updateCreatorDetails } from "@/services/profiles";
import { AVAILABILITY, COMPANY_SIZES, CURRENCIES, EXPERIENCE_LEVELS } from "@/config/constants";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { Chip, ToggleChip } from "@/components/ui/chip";
import { cn, errorMessage } from "@/lib/utils";

const PROFICIENCY = ["learning", "proficient", "expert"] as const;

// ---------------------------------------------------------------------------
// Specialisation, tools, skills… (the core of discoverability)
// ---------------------------------------------------------------------------
export function CreatorAttributesForm({ profile, onSaved, submitLabel = "Save" }: { profile: FullProfile; onSaved?: () => void; submitLabel?: string }) {
  const db = useDb();
  const lookups = useLookups();
  const [tools, setTools] = useState(profile.tools.map((t) => ({ id: t.id, proficiency: t.proficiency ?? "proficient" })));
  const [skills, setSkills] = useState(profile.skills.map((x) => x.id));
  const [categories, setCategories] = useState(profile.categories.map((x) => x.id));
  const [contentTypes, setContentTypes] = useState(profile.content_types.map((x) => x.id));
  const [styles, setStyles] = useState(profile.styles.map((x) => x.id));
  const [languages, setLanguages] = useState(profile.languages.map((x) => x.id));
  const [platforms, setPlatforms] = useState(profile.platforms.map((x) => x.id));
  const [saving, setSaving] = useState(false);

  if (lookups.isPending) return <Skeleton className="h-80" />;
  if (!lookups.data) return <p className="text-sm text-danger">Couldn&apos;t load options. Refresh to try again.</p>;
  const L = lookups.data;
  const opts = (xs: { id: number; name: string }[]) => xs.map((x) => ({ value: x.id, label: x.name }));
  const toolName = (id: number) => L.ai_tools.find((t) => t.id === id)?.name ?? "";

  async function save() {
    if (!tools.length) return toast.error("Add at least one AI tool so brands can find you");
    if (!categories.length) return toast.error("Pick at least one specialisation");
    setSaving(true);
    try {
      await setCreatorAttributes(db, { tools, skills, categories, content_types: contentTypes, styles, languages, platforms });
      toast.success("Skills & tools saved");
      onSaved?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label="Specialisations" hint="What you're known for (max 3)">
        <MultiSelect label="Specialisations" options={opts(L.categories)} value={categories} onChange={setCategories} max={3} placeholder="Choose specialisations" />
      </Field>
      <Field label="AI tools & models" hint="Set your proficiency for each — shown on your profile">
        <MultiSelect
          label="AI tools"
          options={L.ai_tools.map((t) => ({ value: t.id, label: t.name, group: t.category ?? undefined }))}
          value={tools.map((t) => t.id)}
          onChange={(ids) => setTools(ids.map((id) => tools.find((t) => t.id === id) ?? { id, proficiency: "proficient" }))}
          placeholder="Choose tools"
        />
        {tools.length > 0 && (
          <ul className="mt-3 space-y-2">
            {tools.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-card px-3 py-2">
                <span className="mr-auto text-sm font-medium">{toolName(t.id)}</span>
                {PROFICIENCY.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setTools(tools.map((x) => (x.id === t.id ? { ...x, proficiency: p } : x)))}
                    className={cn("rounded-full px-2.5 py-1 text-xs capitalize", t.proficiency === p ? "bg-amber text-on-amber" : "bg-ink/5 text-ink-2")}
                    aria-pressed={t.proficiency === p}
                  >
                    {p}
                  </button>
                ))}
                <button type="button" aria-label={`Remove ${toolName(t.id)}`} onClick={() => setTools(tools.filter((x) => x.id !== t.id))} className="text-ink-3 hover:text-ink">
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Skills"><MultiSelect label="Skills" options={opts(L.skills)} value={skills} onChange={setSkills} placeholder="Choose skills" /></Field>
        <Field label="Content types"><MultiSelect label="Content types" options={opts(L.content_types)} value={contentTypes} onChange={setContentTypes} placeholder="What you deliver" /></Field>
        <Field label="Styles"><MultiSelect label="Styles" options={opts(L.styles)} value={styles} onChange={setStyles} placeholder="Your visual styles" /></Field>
        <Field label="Languages"><MultiSelect label="Languages" options={opts(L.languages)} value={languages} onChange={setLanguages} placeholder="Languages you work in" /></Field>
        <Field label="Platforms" className="sm:col-span-2"><MultiSelect label="Platforms" options={opts(L.platforms)} value={platforms} onChange={setPlatforms} placeholder="Where your work runs" /></Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} loading={saving}>{submitLabel}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Experience level, availability, rates, workflow
// ---------------------------------------------------------------------------
export function CreatorDetailsForm({ profile, onSaved, submitLabel = "Save" }: { profile: FullProfile; onSaved?: () => void; submitLabel?: string }) {
  const db = useDb();
  const c = profile.creator;
  const [v, setV] = useState({
    experience_level: c?.experience_level ?? "emerging",
    availability: c?.availability ?? "open",
    years_experience: c?.years_experience?.toString() ?? "",
    rate_min: c?.rate_min?.toString() ?? "",
    rate_max: c?.rate_max?.toString() ?? "",
    currency: c?.currency ?? "USD",
    workflow_overview: c?.workflow_overview ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof v, value: string) => setV((s) => ({ ...s, [k]: value }));
  const num = (s: string) => (s.trim() === "" ? null : s);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = creatorDetailsSchema.safeParse({
      ...v, years_experience: num(v.years_experience), rate_min: num(v.rate_min), rate_max: num(v.rate_max),
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await updateCreatorDetails(db, parsed.data);
      toast.success("Details saved");
      onSaved?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Experience level</legend>
        <div className="flex flex-wrap gap-2">
          {EXPERIENCE_LEVELS.map((x) => (
            <ToggleChip key={x.value} selected={v.experience_level === x.value} onClick={() => set("experience_level", x.value)}>{x.label}</ToggleChip>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Availability</legend>
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY.map((x) => (
            <ToggleChip key={x.value} selected={v.availability === x.value} onClick={() => set("availability", x.value)}>
              <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", x.dot)} />{x.label}</span>
            </ToggleChip>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Years" htmlFor="years" error={errors.years_experience} optional>
          <Input id="years" inputMode="numeric" value={v.years_experience} onChange={(e) => set("years_experience", e.target.value)} />
        </Field>
        <Field label="Rate from" htmlFor="rate_min" error={errors.rate_min} optional>
          <Input id="rate_min" inputMode="numeric" value={v.rate_min} onChange={(e) => set("rate_min", e.target.value)} />
        </Field>
        <Field label="Rate to" htmlFor="rate_max" error={errors.rate_max} optional>
          <Input id="rate_max" inputMode="numeric" value={v.rate_max} onChange={(e) => set("rate_max", e.target.value)} />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Select id="currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Your workflow" htmlFor="workflow" optional hint="How you take a brief from idea to delivery — tools at each step, how you keep characters consistent, how you document provenance.">
        <Textarea id="workflow" rows={4} maxLength={2000} value={v.workflow_overview} onChange={(e) => set("workflow_overview", e.target.value)}
          placeholder="Script in Claude → keyframes in Midjourney → image-to-video in Runway → grade in DaVinci…" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Past brand / campaign work
// ---------------------------------------------------------------------------
export function ExperienceManager({ profile, onChanged }: { profile: FullProfile; onChanged: () => void }) {
  const db = useDb();
  const empty = { brand_name: "", project_title: "", year: "", description: "", link: "" };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(profile.experiences.length === 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const parsed = experienceSchema.safeParse({ ...v, year: v.year || null });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await addExperience(db, parsed.data);
      setV(empty);
      setOpen(false);
      toast.success("Project added");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteExperience(db, id);
      toast.success("Removed");
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      {profile.experiences.map((x) => (
        <div key={x.id} className="flex items-start gap-3 rounded-2xl bg-card p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{x.brand_name} · {x.project_title} {x.year && <span className="font-normal text-ink-3">({x.year})</span>}</p>
            {x.description && <p className="mt-1 text-sm text-ink-2">{x.description}</p>}
            {x.verified && <Chip tone="amber" className="mt-2">Verified collaboration</Chip>}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Remove project" onClick={() => remove(x.id)}><Trash2 /></Button>
        </div>
      ))}
      {open ? (
        <form onSubmit={add} className="space-y-3 rounded-3xl border border-dashed border-line p-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Brand / client" error={errors.brand_name}><Input value={v.brand_name} onChange={(e) => setV({ ...v, brand_name: e.target.value })} /></Field>
            <Field label="Project" error={errors.project_title}><Input value={v.project_title} onChange={(e) => setV({ ...v, project_title: e.target.value })} /></Field>
            <Field label="Year" error={errors.year} optional><Input inputMode="numeric" value={v.year} onChange={(e) => setV({ ...v, year: e.target.value })} /></Field>
          </div>
          <Field label="What you delivered" optional><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
          <Field label="Link" error={errors.link} optional><Input type="url" placeholder="https://" value={v.link} onChange={(e) => setV({ ...v, link: e.target.value })} /></Field>
          <div className="flex justify-end gap-2">
            {profile.experiences.length > 0 && <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
            <Button type="submit" variant="primary" loading={busy}>Add project</Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setOpen(true)}><Plus /> Add past project</Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand company details
// ---------------------------------------------------------------------------
export function BrandDetailsForm({ profile, onSaved, submitLabel = "Save" }: { profile: FullProfile; onSaved?: () => void; submitLabel?: string }) {
  const db = useDb();
  const b = profile.brand;
  const [v, setV] = useState({
    company_name: b?.company_name ?? profile.display_name,
    industry: b?.industry ?? "",
    company_size: b?.company_size ?? "",
    description: b?.description ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = brandDetailsSchema.safeParse({ ...v, company_size: v.company_size || null });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await updateBrandDetails(db, parsed.data);
      toast.success("Company details saved");
      onSaved?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" htmlFor="company" error={errors.company_name}>
          <Input id="company" value={v.company_name} onChange={(e) => setV({ ...v, company_name: e.target.value })} />
        </Field>
        <Field label="Industry" htmlFor="industry" optional>
          <Input id="industry" value={v.industry} onChange={(e) => setV({ ...v, industry: e.target.value })} placeholder="e.g. Fashion & apparel" />
        </Field>
      </div>
      <Field label="Company size" htmlFor="size" optional>
        <Select id="size" value={v.company_size} onChange={(e) => setV({ ...v, company_size: e.target.value })}>
          <option value="">Prefer not to say</option>
          {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s} people</option>)}
        </Select>
      </Field>
      <Field label="About the company" htmlFor="desc" optional>
        <Textarea id="desc" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving}>{submitLabel}</Button>
      </div>
    </form>
  );
}
