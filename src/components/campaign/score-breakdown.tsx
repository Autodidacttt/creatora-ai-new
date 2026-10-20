import type { ScoreBreakdown as Breakdown } from "@/types/app";

const LABELS: Record<string, string> = {
  tools: "Tools match",
  skills: "Skills match",
  portfolio: "Portfolio relevance",
  experience: "Campaign experience",
  fit: "Platform & audience fit",
  availability: "Availability",
};
const ORDER = ["tools", "portfolio", "skills", "experience", "fit", "availability"];

/** Transparent weighted scoring: each factor's contribution out of its maximum. */
export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  return (
    <dl className="space-y-1.5">
      {ORDER.filter((k) => breakdown[k]).map((k) => {
        const { score, max } = breakdown[k];
        const pct = max ? Math.round((score / max) * 100) : 0;
        return (
          <div key={k} className="grid grid-cols-[8.5rem_1fr_2.5rem] items-center gap-2 text-xs">
            <dt className="text-ink-2">{LABELS[k] ?? k}</dt>
            <dd className="h-1.5 overflow-hidden rounded-full bg-ink/10" aria-label={`${score} of ${max}`}>
              <div className="h-full rounded-full bg-amber-2 transition-all duration-700" style={{ width: `${pct}%` }} />
            </dd>
            <dd className="text-right tabular-nums text-ink-3">{score}/{max}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function ScoreRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title="Relevance to this brief — not a measure of talent">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-ink/10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--amber-2)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * score) / 100} className="transition-all duration-1000" />
      </svg>
      <span className="display absolute inset-0 grid place-items-center text-lg tabular-nums">{score}</span>
    </div>
  );
}
