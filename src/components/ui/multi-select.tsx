"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./overlay";

export interface Option<V extends string | number> {
  value: V;
  label: string;
  group?: string;
}

/** Searchable multi-select popover. Options always come from the database lookups. */
export function MultiSelect<V extends string | number>({
  label, options, value, onChange, placeholder = "Any", className, max, compactTrigger,
}: {
  label: string;
  options: Option<V>[];
  value: V[];
  onChange: (value: V[]) => void;
  placeholder?: string;
  className?: string;
  max?: number;
  compactTrigger?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  );
  const selected = options.filter((o) => value.includes(o.value));
  const toggle = (v: V) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else if (!max || value.length < max) onChange([...value, v]);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-2xl border bg-card px-4 text-left text-sm transition-colors",
            value.length ? "border-amber" : "border-line hover:border-ink/25",
            compactTrigger && "h-9 w-auto rounded-full px-3 text-xs",
            className,
          )}
          aria-label={`${label}: ${selected.length ? selected.map((s) => s.label).join(", ") : placeholder}`}
        >
          <span className="truncate">
            {compactTrigger ? <span className="font-medium">{label}</span> : null}
            {compactTrigger && value.length > 0 && <span className="ml-1 rounded-full bg-amber px-1.5 text-[10px] text-on-amber">{value.length}</span>}
            {!compactTrigger && (selected.length ? (
              <span>{selected.slice(0, 2).map((s) => s.label).join(", ")}{selected.length > 2 && ` +${selected.length - 2}`}</span>
            ) : (
              <span className="text-ink-3">{placeholder}</span>
            ))}
          </span>
          <ChevronDown className="size-4 shrink-0 text-ink-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            className="h-9 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber/40"
          />
        </div>
        <div role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto pr-1">
          {filtered.length === 0 && <p className="px-3 py-4 text-center text-sm text-ink-3">No matches</p>}
          {filtered.map((o, i) => {
            const on = value.includes(o.value);
            const showGroup = o.group && o.group !== filtered[i - 1]?.group;
            return (
              <div key={String(o.value)}>
                {showGroup && <p className="eyebrow px-3 pb-1 pt-2">{o.group}</p>}
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-ink/5"
                >
                  <span className={cn("grid size-4 place-items-center rounded-md border", on ? "border-amber bg-amber text-on-amber" : "border-line")}>
                    {on && <Check className="size-3" />}
                  </span>
                  {o.label}
                </button>
              </div>
            );
          })}
        </div>
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs text-ink-2 hover:bg-ink/5">
            <X className="size-3" /> Clear {label.toLowerCase()}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
