"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Palette, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { Guideline } from "@/types/workspace";
import { useDb } from "@/features/session";
import { listGuidelines, saveGuideline, uploadBrandLogo } from "@/services/workspace";
import { guidelineSchema, type GuidelineInput } from "@/lib/validation/workspace";
import { chromaticSwatches, extractPalette, type Swatch } from "@/lib/media/palette";
import { imagePixels } from "@/lib/media/client-frames";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { errorMessage } from "@/lib/utils";
import { ListEditor } from "./list-editor";

const blank: GuidelineInput = {
  name: "Brand guidelines", logo_url: null, primary_colors: [], secondary_colors: [], fonts: [], tone_of_voice: null,
  visual_style: null, dos: [], donts: [], restricted_content: null,
};
const toInput = (g: Guideline): GuidelineInput => ({
  name: g.name, logo_url: g.logo_url, primary_colors: g.primary_colors, secondary_colors: g.secondary_colors, fonts: g.fonts,
  tone_of_voice: g.tone_of_voice, visual_style: g.visual_style, dos: g.dos, donts: g.donts, restricted_content: g.restricted_content,
});

function ColourList({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [hex, setHex] = useState("#F5A800");
  return (
    <Field label={label}>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((c, i) => (
          <span key={`${c}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card py-1 pl-1 pr-2 text-xs font-mono">
            <input type="color" value={c} aria-label={`Edit colour ${c}`} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
              className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" />
            {c}
            <button type="button" aria-label={`Remove ${c}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-3" /></button>
          </span>
        ))}
        {value.length < 8 && (
          <span className="inline-flex items-center gap-1.5">
            <input type="color" value={hex} aria-label="Pick a colour" onChange={(e) => setHex(e.target.value.toUpperCase())} className="size-8 cursor-pointer rounded-lg border border-line bg-transparent p-0.5" />
            <Input value={hex} onChange={(e) => setHex(e.target.value.toUpperCase())} className="h-8 w-28 font-mono text-xs" aria-label="Hex colour" maxLength={7} />
            <Button size="sm" variant="secondary" onClick={() => {
              if (!/^#[0-9A-F]{6}$/.test(hex)) return toast.error("Use a 6-digit hex like #F5A800");
              if (!value.includes(hex)) onChange([...value, hex]);
            }}><Plus /> Add</Button>
          </span>
        )}
      </div>
    </Field>
  );
}

/** Step 3: Brand DNA — reusable guidelines (logo, colours, fonts, tone, do/don't) attached to this campaign. */
export function StepGuidelines({ guidelineId, onSelect }: { guidelineId: string | null; onSelect: (id: string | null) => void }) {
  const db = useDb();
  const list = useQuery({ queryKey: ["guidelines"], queryFn: () => listGuidelines(db) });
  if (list.isPending) return <Skeleton className="h-96 rounded-[1.75rem]" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return <GuidelinesEditor guidelines={list.data} guidelineId={guidelineId} onSelect={onSelect} />;
}

function GuidelinesEditor({ guidelines, guidelineId, onSelect }: { guidelines: Guideline[]; guidelineId: string | null; onSelect: (id: string | null) => void }) {
  const db = useDb();
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(() => guidelines.find((g) => g.id === guidelineId)?.id ?? null);
  const [form, setForm] = useState<GuidelineInput>(() => {
    const g = guidelines.find((x) => x.id === guidelineId);
    return g ? toInput(g) : blank;
  });
  const [suggested, setSuggested] = useState<Swatch[]>([]);
  const [busy, setBusy] = useState<"save" | "logo" | null>(null);
  const set = <K extends keyof GuidelineInput>(k: K, v: GuidelineInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function onLogo(file: File) {
    setBusy("logo");
    try {
      const pixels = await imagePixels(file);
      if (pixels) setSuggested(chromaticSwatches(extractPalette(pixels, 4, 6)).slice(0, 5));
      set("logo_url", await uploadBrandLogo(db, file));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const parsed = guidelineSchema.safeParse(form);
    if (!parsed.success) return toast.error(`${parsed.error.issues[0]?.path.join(" › ")}: ${parsed.error.issues[0]?.message}`);
    setBusy("save");
    try {
      const g = await saveGuideline(db, editingId, parsed.data);
      qc.invalidateQueries({ queryKey: ["guidelines"] });
      setEditingId(g.id);
      onSelect(g.id);
      toast.success(`Guidelines saved (v${g.version}) and attached to this campaign`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-3 rounded-[1.75rem] p-4">
        <Palette className="size-5" aria-hidden />
        <Select aria-label="Brand guidelines for this campaign" className="h-10 max-w-sm flex-1" value={editingId ?? ""} onChange={(e) => {
          const g = guidelines.find((x) => x.id === e.target.value);
          if (g) { setForm(toInput(g)); setEditingId(g.id); onSelect(g.id); } else { setForm(blank); setEditingId(null); onSelect(null); }
        }}>
          <option value="">+ New guidelines</option>
          {guidelines.map((g) => <option key={g.id} value={g.id}>{g.name} · v{g.version}</option>)}
        </Select>
        <p className="text-xs text-ink-3">Reusable across campaigns. The AI review checks submissions against them.</p>
      </div>

      <section className="glass space-y-5 rounded-[1.75rem] p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Name" htmlFor="g-name"><Input id="g-name" value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              {form.logo_url ? <img src={form.logo_url} alt="Logo" className="h-11 max-w-32 rounded-lg bg-white object-contain p-1" /> : null}
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-4 text-sm hover:-translate-y-0.5">
                <ImagePlus className="size-4" /> {busy === "logo" ? "Uploading…" : form.logo_url ? "Replace" : "Upload"}
                <input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogo(f); e.target.value = ""; }} />
              </label>
            </div>
          </Field>
        </div>
        {suggested.length > 0 && (
          <div className="rounded-2xl bg-amber-soft/50 p-3">
            <p className="mb-2 text-xs font-medium">Suggested from your logo — click to add</p>
            <div className="flex flex-wrap gap-2">
              {suggested.map((s) => (
                <button key={s.hex} type="button" onClick={() => !form.primary_colors.includes(s.hex) && set("primary_colors", [...form.primary_colors, s.hex].slice(0, 8))}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card py-1 pl-1 pr-2.5 text-xs font-mono hover:-translate-y-0.5">
                  <span className="size-5 rounded-full border border-line" style={{ background: s.hex }} aria-hidden />{s.hex}
                  <span className="text-ink-3">{Math.round(s.share * 100)}%</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <ColourList label="Primary colours" value={form.primary_colors} onChange={(v) => set("primary_colors", v)} />
        <ColourList label="Secondary colours" value={form.secondary_colors} onChange={(v) => set("secondary_colors", v)} />
        <Field label="Fonts"><ListEditor label="Font" max={6} value={form.fonts} onChange={(v) => set("fonts", v)} placeholder="e.g. Neue Haas Grotesk Display" /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tone of voice" htmlFor="g-tone"><Textarea id="g-tone" value={form.tone_of_voice ?? ""} maxLength={1000} className="min-h-20" onChange={(e) => set("tone_of_voice", e.target.value || null)} /></Field>
          <Field label="Visual style" htmlFor="g-vis"><Textarea id="g-vis" value={form.visual_style ?? ""} maxLength={2000} className="min-h-20" onChange={(e) => set("visual_style", e.target.value || null)} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Do"><ListEditor label="Do" value={form.dos} onChange={(v) => set("dos", v)} placeholder="e.g. Show the product in natural light" /></Field>
          <Field label="Don't"><ListEditor label="Don't" value={form.donts} onChange={(v) => set("donts", v)} placeholder="e.g. Never distort the logo" /></Field>
        </div>
        <Field label="Restricted content" htmlFor="g-res" optional><Textarea id="g-res" value={form.restricted_content ?? ""} maxLength={1000} className="min-h-16" onChange={(e) => set("restricted_content", e.target.value || null)} placeholder="e.g. No alcohol, no competitor products, no real people's likenesses" /></Field>
        <div className="flex justify-end"><Button variant="primary" loading={busy === "save"} onClick={save}><Save /> Save & use for this campaign</Button></div>
      </section>
    </div>
  );
}
