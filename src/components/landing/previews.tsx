"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { BadgeCheck, FileText, Search, Sparkles } from "lucide-react";
import type { CreatorCard } from "@/types/app";
import { Avatar } from "@/components/ui/avatar";
import { Chip } from "@/components/ui/chip";
import { ScoreBreakdown, ScoreRing } from "@/components/campaign/score-breakdown";
import { EscrowChip, ProjectStepper } from "@/components/workspace/status";
import { BADGE_TEXT, TrustBadges } from "@/components/verification/trust-badges";
import { useEffects } from "@/components/astral/effects";
import { compact } from "@/lib/utils";

/** Small "example" tag so illustrative values are never mistaken for live data. */
const Example = ({ children = "Example" }: { children?: string }) => (
  <span className="rounded-full border border-dashed border-line px-2 py-0.5 text-[10px] text-ink-3">{children}</span>
);

const panel = "rounded-[1.5rem] border border-glass-border bg-glass-strong p-4 shadow-soft backdrop-blur-xl";

/** 1 · AI portfolio piece: a real creator's piece and the tools on their profile. */
export function PortfolioPreview({ creator }: { creator?: CreatorCard }) {
  const piece = creator?.preview.find((p) => p.url && p.media_type === "image");
  if (!creator) return <Fallback icon={<Sparkles />} text="Portfolio pieces list the tools and workflow behind them." />;
  return (
    <div className={panel}>
      <div className="flex items-center gap-2">
        <Avatar src={creator.avatar_url} name={creator.display_name} size="sm" verified={creator.is_verified} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{creator.display_name}</p>
          <p className="truncate text-xs text-ink-3">{creator.headline ?? "AI creator"}</p>
        </div>
      </div>
      {piece?.url && (
        <div className="relative mt-3 aspect-[16/10] overflow-hidden rounded-2xl bg-bg-2">
          <img src={piece.url} alt={piece.title} loading="lazy" className="size-full object-cover" />
          <span className="absolute inset-x-2 bottom-2 truncate rounded-full bg-black/45 px-2.5 py-1 text-xs text-white backdrop-blur">{piece.title}</span>
        </div>
      )}
      <p className="eyebrow mt-3">Tools</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {creator.tools.slice(0, 5).map((t) => <Chip key={t.id} tone="glass">{t.name}</Chip>)}
      </div>
    </div>
  );
}

/** 2 · Discovery: real tools as filters, real creators as results, the real creator count. */
export function DiscoveryPreview({ creators, total }: { creators: CreatorCard[]; total: number | null }) {
  const tools = [...new Map(creators.flatMap((c) => c.tools).map((t) => [t.id, t])).values()].slice(0, 5);
  return (
    <div className={panel}>
      <div className="flex h-10 items-center gap-2 rounded-full border border-line bg-card px-3 text-sm text-ink-3">
        <Search className="size-4" /> Search creators, tools…
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tools.map((t, i) => <Chip key={t.id} tone={i < 2 ? "solid" : "outline"}>{t.name}</Chip>)}
        <Chip tone="outline" icon={<BadgeCheck />}>Verified only</Chip>
      </div>
      <ul className="mt-3 space-y-1.5">
        {creators.slice(0, 3).map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-2xl bg-ink/[0.03] px-2.5 py-2">
            <Avatar src={c.avatar_url} name={c.display_name} size="xs" />
            <span className="truncate text-sm">{c.display_name}</span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-3">{compact(c.followers_count)} followers</span>
          </li>
        ))}
      </ul>
      {total != null && <p className="mt-3 text-xs text-ink-3"><span className="font-semibold text-ink">{compact(total)}</span> creators on Creatora today</p>}
    </div>
  );
}

const BRIEF = "Three AI creators for a cinematic Gen Z fashion campaign on Instagram, 9:16, with 12 months of paid-social rights.";

/** 3 · AI brief builder: one sentence in, structured fields out (types itself when scrolled into view). */
export function BriefPreview() {
  const { level } = useEffects();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const [n, setN] = useState(0);
  const shown = level === "full" ? n : BRIEF.length;

  useEffect(() => {
    if (!inView || level !== "full") return;
    const id = setInterval(() => setN((v) => (v >= BRIEF.length ? (clearInterval(id), v) : v + 2)), 28);
    return () => clearInterval(id);
  }, [inView, level]);

  const done = shown >= BRIEF.length;
  const fields: [string, string][] = [["Content type", "Fashion film"], ["Formats", "9:16"], ["Platforms", "Instagram"], ["Usage rights", "Paid social · 12 months"]];
  return (
    <div ref={ref} className={panel}>
      <div className="flex items-center justify-between"><p className="eyebrow">Your sentence</p><Example /></div>
      <p className="mt-2 min-h-16 rounded-2xl bg-ink/[0.03] p-3 text-sm leading-relaxed">
        {BRIEF.slice(0, shown)}
        {!done && <span aria-hidden className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-amber" />}
      </p>
      <p className="eyebrow mt-3 flex items-center gap-1.5"><FileText className="size-3" /> Structured brief</p>
      <dl className="mt-2 grid grid-cols-2 gap-1.5">
        {fields.map(([k, v], i) => (
          <div key={k} className="rounded-xl border border-line px-2.5 py-1.5 transition-all duration-500" style={{ opacity: done ? 1 : 0.25, transitionDelay: `${i * 90}ms` }}>
            <dt className="text-[10px] text-ink-3">{k}</dt>
            <dd className="text-xs font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 4 · Creator finder: the real score ring and factor breakdown, with example values. */
export function FinderPreview() {
  const breakdown = { tools: { score: 21, max: 25 }, portfolio: { score: 20, max: 25 }, skills: { score: 15, max: 20 }, experience: { score: 7, max: 10 }, fit: { score: 9, max: 10 }, availability: { score: 10, max: 10 } };
  return (
    <div className={panel}>
      <div className="flex items-center gap-3">
        <ScoreRing score={82} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Why this creator?</p>
          <p className="text-xs text-ink-2">Uses Midjourney &amp; Runway (2/3 required tools)</p>
        </div>
        <Example />
      </div>
      <div className="mt-4"><ScoreBreakdown breakdown={breakdown} /></div>
      <p className="mt-3 text-[11px] text-ink-3">Scores show relevance to a brief, never a rating of talent.</p>
    </div>
  );
}

/** 5 · Verified identities: the real trust badges with what each one checked. */
export function VerifiedPreview() {
  return (
    <div className={panel}>
      <TrustBadges size="md" badges={{ phone_verified: true, identity_verified: true, company_verified: true }} />
      <ul className="mt-3 space-y-2">
        {(["phone", "identity", "company"] as const).map((k) => (
          <li key={k} className="text-xs text-ink-2"><span className="font-semibold text-ink">{BADGE_TEXT[k].label}.</span> {BADGE_TEXT[k].how}</li>
        ))}
      </ul>
    </div>
  );
}

/** 6 · Secure hiring & delivery: the real project stepper and escrow chips (test mode). */
export function HiringPreview() {
  return (
    <div className={panel}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Project progress</p>
        <Example>Test mode · no real money</Example>
      </div>
      <ProjectStepper status="approved" hired className="mt-3" />
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <EscrowChip status="funded" />
        <span aria-hidden className="text-ink-3">→</span>
        <EscrowChip status="released" />
      </div>
      <p className="mt-3 text-xs text-ink-2">Clean originals unlock only after approval <em className="not-italic text-ink">and</em> payment release, with a verifiable PDF licence record.</p>
    </div>
  );
}

function Fallback({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className={`${panel} flex items-center gap-3 text-sm text-ink-2 [&_svg]:size-5 [&_svg]:text-amber-ink`}>{icon}{text}</div>;
}
