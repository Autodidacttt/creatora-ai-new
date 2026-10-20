"use client";

import { useQuery } from "@tanstack/react-query";
import { SearchX, X } from "lucide-react";
import type { Lookups } from "@/types/app";
import { useDb } from "@/features/session";
import { EMPTY_FILTERS, relatedCreators, searchDiagnostics, type CreatorFilters, type FilterGroup } from "@/services/discovery";
import { AVAILABILITY, EXPERIENCE_LEVELS, labelOf } from "@/config/constants";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { CreatorResultCard } from "./creator-card";

/** Explains which filters caused zero results, offers one-click fixes and related creators. */
export function EmptyResults({ filters, lookups, onChange }: {
  filters: CreatorFilters;
  lookups: Lookups;
  onChange: (p: Partial<CreatorFilters>) => void;
}) {
  const db = useDb();
  const diag = useQuery({ queryKey: ["search-diag", filters], queryFn: () => searchDiagnostics(db, filters) });
  const related = useQuery({ queryKey: ["search-related", filters], queryFn: () => relatedCreators(db, filters) });

  const names = (ids: number[], list: { id: number; name: string }[]) => ids.map((id) => list.find((x) => x.id === id)?.name).filter(Boolean).join(", ");
  const describe: Record<FilterGroup, () => { label: string; value: string; clear: Partial<CreatorFilters> }> = {
    query: () => ({ label: "Search", value: `“${filters.q}”`, clear: { q: "" } }),
    tools: () => ({ label: "AI tools", value: names(filters.tools, lookups.ai_tools), clear: { tools: [] } }),
    skills: () => ({ label: "Skills", value: names(filters.skills, lookups.skills), clear: { skills: [] } }),
    categories: () => ({ label: "Specialisation", value: names(filters.categories, lookups.categories), clear: { categories: [] } }),
    content_types: () => ({ label: "Content type", value: names(filters.contentTypes, lookups.content_types), clear: { contentTypes: [] } }),
    styles: () => ({ label: "Style", value: names(filters.styles, lookups.styles), clear: { styles: [] } }),
    experience: () => ({ label: "Experience", value: filters.experience.map((e) => labelOf(EXPERIENCE_LEVELS, e)).join(", "), clear: { experience: [] } }),
    availability: () => ({ label: "Availability", value: filters.availability.map((e) => labelOf(AVAILABILITY, e)).join(", "), clear: { availability: [] } }),
    languages: () => ({ label: "Language", value: names(filters.languages, lookups.languages), clear: { languages: [] } }),
    verified: () => ({ label: "Verified only", value: "on", clear: { verified: false } }),
  };
  const rows = (diag.data ?? []).map((d) => ({ ...d, ...describe[d.group]() })).sort((a, b) => b.resultsWithout - a.resultsWithout);

  return (
    <div className="space-y-6">
      <div className="glass rounded-[2rem] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-full bg-amber-soft"><SearchX className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <h2 className="display text-xl">No creators match all of these filters</h2>
            <p className="mt-1 text-sm text-ink-2">Filters combine with AND across groups. Here&apos;s what each one is costing you:</p>
          </div>
        </div>
        <ul className="mt-5 space-y-2">
          {diag.isPending && [0, 1].map((i) => <Skeleton key={i} className="h-12" />)}
          {rows.map((r) => (
            <li key={r.group} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3">
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{r.label}:</span> {r.value}
                <span className="block text-xs text-ink-3">
                  {r.resultsWithout > 0 ? `Removing it shows ${r.resultsWithout} creator${r.resultsWithout === 1 ? "" : "s"}` : "Still no results without it"}
                </span>
              </span>
              <Button size="sm" variant={r.resultsWithout > 0 ? "primary" : "outline"} onClick={() => onChange(r.clear)}>
                <X /> Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="dark" onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}>Clear all filters</Button>
        </div>
      </div>

      <div>
        <h3 className="display mb-3 text-lg">Related creators <span className="text-sm font-normal text-ink-3">· match some of your filters</span></h3>
        {related.isPending && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-80" />)}</div>}
        {related.data?.length === 0 && <p className="text-sm text-ink-2">No close matches either — try a broader search.</p>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {related.data?.map((c) => <CreatorResultCard key={c.id} creator={c} highlightTools={filters.tools} />)}
        </div>
      </div>
    </div>
  );
}
