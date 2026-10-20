"use client";

import { useState } from "react";
import { BadgeCheck, SlidersHorizontal, X } from "lucide-react";
import type { Lookups } from "@/types/app";
import { activeFilterCount, EMPTY_FILTERS, type CreatorFilters } from "@/services/discovery";
import { AVAILABILITY, EXPERIENCE_LEVELS } from "@/config/constants";
import { MultiSelect } from "@/components/ui/multi-select";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Patch = (p: Partial<CreatorFilters>) => void;

function useGroups(l: Lookups, f: CreatorFilters, set: Patch) {
  const o = (xs: { id: number; name: string }[]) => xs.map((x) => ({ value: x.id, label: x.name }));
  return [
    { key: "tools", label: "AI tools", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="AI tools" options={l.ai_tools.map((t) => ({ value: t.id, label: t.name, group: t.category }))} value={f.tools} onChange={(tools) => set({ tools })} /> },
    { key: "skills", label: "Skills", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="Skills" options={o(l.skills)} value={f.skills} onChange={(skills) => set({ skills })} /> },
    { key: "categories", label: "Specialisation", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="Specialisation" options={o(l.categories)} value={f.categories} onChange={(categories) => set({ categories })} /> },
    { key: "types", label: "Content type", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="Content type" options={o(l.content_types)} value={f.contentTypes} onChange={(contentTypes) => set({ contentTypes })} /> },
    { key: "styles", label: "Style", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="Style" options={o(l.styles)} value={f.styles} onChange={(styles) => set({ styles })} /> },
    { key: "exp", label: "Experience", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="Experience" options={EXPERIENCE_LEVELS} value={f.experience} onChange={(experience) => set({ experience })} /> },
    { key: "avail", label: "Availability", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="Availability" options={AVAILABILITY} value={f.availability} onChange={(availability) => set({ availability })} /> },
    { key: "langs", label: "Language", node: (c?: boolean) => <MultiSelect compactTrigger={c} label="Language" options={o(l.languages)} value={f.languages} onChange={(languages) => set({ languages })} /> },
  ];
}

function VerifiedToggle({ f, set }: { f: CreatorFilters; set: Patch }) {
  return (
    <button
      type="button"
      onClick={() => set({ verified: !f.verified })}
      aria-pressed={f.verified}
      className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        f.verified ? "border-amber bg-amber text-on-amber" : "border-line bg-card hover:border-ink/25")}
    >
      <BadgeCheck className="size-3.5" /> Verified only
    </button>
  );
}

/** Desktop: inline filter pills. Mobile: a "Filters" sheet. */
export function FilterPanel({ lookups, filters, onChange }: { lookups: Lookups; filters: CreatorFilters; onChange: Patch }) {
  const [open, setOpen] = useState(false);
  const groups = useGroups(lookups, filters, onChange);
  const count = activeFilterCount(filters);
  const reset = () => onChange({ ...EMPTY_FILTERS, q: filters.q, sort: filters.sort });

  return (
    <>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {groups.map((g) => <div key={g.key}>{g.node(true)}</div>)}
        <VerifiedToggle f={filters} set={onChange} />
        {count > 0 && (
          <button onClick={reset} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-ink-2 hover:bg-ink/5">
            <X className="size-3.5" /> Clear filters
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 md:hidden">
        <Button size="sm" onClick={() => setOpen(true)}>
          <SlidersHorizontal /> Filters {count > 0 && <span className="rounded-full bg-amber px-1.5 text-[10px] text-on-amber">{count}</span>}
        </Button>
        <VerifiedToggle f={filters} set={onChange} />
      </div>
      <Dialog open={open} onOpenChange={setOpen} title="Filter creators" size="sm">
        <div className="space-y-3">
          {groups.map((g) => <Field key={g.key} label={g.label}>{g.node(false)}</Field>)}
          <div className="flex justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={reset} disabled={!count}>Clear all</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Show results</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
