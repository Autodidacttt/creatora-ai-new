"use client";

import { Building2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "individual", icon: UserRound, title: "Individual Recruiter", body: "You hire creators yourself. Verify with your phone and a government ID." },
  { value: "company", icon: Building2, title: "Company / Organization", body: "You act for a company. Verify with your phone; an official company contact confirms you." },
] as const;

/** "What type of brand account are you creating?" — two selectable cards (radio group). */
export function BrandTypePicker({ value, onChange, disabled }: { value: "individual" | "company" | null; onChange: (v: "individual" | "company") => void; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold">What type of brand account are you creating?</legend>
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
            className={cn("flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors focus-visible:ring-4 focus-visible:ring-amber/30 disabled:opacity-60",
              value === o.value ? "border-amber bg-amber-soft/70" : "border-line bg-card hover:border-amber/60")}>
            <o.icon className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              <span className="block text-sm font-semibold">{o.title}</span>
              <span className="block text-xs text-ink-2">{o.body}</span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
