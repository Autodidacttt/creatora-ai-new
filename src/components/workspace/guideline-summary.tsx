/* eslint-disable @next/next/no-img-element */
import { Check, X } from "lucide-react";
import type { Guideline } from "@/types/workspace";

export function Swatch({ hex, size = "md" }: { hex: string; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-ink-2">
      <span className={size === "sm" ? "size-4 rounded-md border border-line" : "size-6 rounded-lg border border-line"} style={{ background: hex }} aria-hidden />
      {hex}
    </span>
  );
}

/** Read-only view of brand guidelines (creators see this on their project). */
export function GuidelineSummary({ g }: { g: Guideline }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-4">
        {g.logo_url && <img src={g.logo_url} alt={`${g.name} logo`} className="h-12 max-w-40 rounded-lg bg-white object-contain p-1" />}
        <div>
          <p className="font-semibold">{g.name}</p>
          <p className="text-xs text-ink-3">Version {g.version}</p>
        </div>
      </div>
      {(g.primary_colors.length > 0 || g.secondary_colors.length > 0) && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-ink-2">Colours</p>
          <div className="flex flex-wrap gap-3">{g.primary_colors.map((c) => <Swatch key={`p${c}`} hex={c} />)}</div>
          {g.secondary_colors.length > 0 && <div className="flex flex-wrap gap-3">{g.secondary_colors.map((c) => <Swatch key={`s${c}`} hex={c} size="sm" />)}</div>}
        </div>
      )}
      {g.fonts.length > 0 && <p><span className="text-xs font-semibold text-ink-2">Fonts · </span>{g.fonts.join(", ")}</p>}
      {g.tone_of_voice && <p><span className="text-xs font-semibold text-ink-2">Tone · </span>{g.tone_of_voice}</p>}
      {g.visual_style && <p className="whitespace-pre-line"><span className="text-xs font-semibold text-ink-2">Visual style · </span>{g.visual_style}</p>}
      {(g.dos.length > 0 || g.donts.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ul className="space-y-1">{g.dos.map((d) => <li key={d} className="flex gap-1.5"><Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Do" />{d}</li>)}</ul>
          <ul className="space-y-1">{g.donts.map((d) => <li key={d} className="flex gap-1.5"><X className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="Don't" />{d}</li>)}</ul>
        </div>
      )}
      {g.restricted_content && <p className="rounded-xl bg-danger/5 px-3 py-2 text-xs"><b>Restricted:</b> {g.restricted_content}</p>}
    </div>
  );
}
