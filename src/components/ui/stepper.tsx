"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * [−] [number] [+] for whole numbers. The value is always a number within [min, max]; the text box can be cleared
 * and retyped freely and only commits (clamped) on blur / Enter, so "12" can become "3" without fighting the input.
 * Arrow Up/Down step by 1, Page Up/Down by 10, Home/End jump to the bounds.
 */
export function Stepper({ value, onChange, min = 1, max = 100, id, label, disabled, className, hint }: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  id?: string;
  /** Accessible name when there's no visible <label htmlFor> */
  label?: string;
  disabled?: boolean;
  className?: string;
  hint?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(n)) onChange(clamp(n));
  };
  const step = (d: number) => onChange(clamp((Number.isFinite(value) ? value : min) + d));

  return (
    <div className={cn("space-y-1", className)}>
      <div role="group" aria-label={label} className="flex h-11 w-full max-w-[11rem] items-stretch overflow-hidden rounded-2xl border border-line bg-card focus-within:border-amber focus-within:ring-4 focus-within:ring-amber/25">
        <button type="button" onClick={() => step(-1)} disabled={disabled || value <= min} aria-label="Decrease"
          className="grid w-11 shrink-0 place-items-center text-ink-2 transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-35">
          <Minus className="size-4" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          role="spinbutton"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(e.currentTarget.value); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setDraft(null); step(1); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setDraft(null); step(-1); }
            else if (e.key === "PageUp") { e.preventDefault(); setDraft(null); step(10); }
            else if (e.key === "PageDown") { e.preventDefault(); setDraft(null); step(-10); }
            else if (e.key === "Home") { e.preventDefault(); setDraft(null); onChange(min); }
            else if (e.key === "End") { e.preventDefault(); setDraft(null); onChange(max); }
          }}
          className="w-full min-w-0 border-x border-line bg-transparent text-center text-sm font-semibold tabular-nums text-ink focus:outline-none disabled:opacity-60"
        />
        <button type="button" onClick={() => step(1)} disabled={disabled || value >= max} aria-label="Increase"
          className="grid w-11 shrink-0 place-items-center text-ink-2 transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-35">
          <Plus className="size-4" />
        </button>
      </div>
      {hint && <p className="text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}
