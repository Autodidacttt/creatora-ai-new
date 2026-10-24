"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { CreatorCard } from "@/types/app";
import { Avatar } from "@/components/ui/avatar";
import { Chip, VerifiedChip } from "@/components/ui/chip";
import { TrustBadges } from "@/components/verification/trust-badges";
import { ScrollSection } from "@/components/astral/scroll-section";
import { GlowCard, ScrollReveal, SPRING } from "@/components/astral/interactive";
import { ConstellationMark } from "@/components/astral/ornaments";
import { cn, compact } from "@/lib/utils";

/** Two orbits around the brief; positions are % of the square. */
function place(i: number, n: number) {
  const outer = i % 2 === 1;
  const a = (i / n) * Math.PI * 2 - Math.PI / 2 + (outer ? 0.35 : 0);
  const r = outer ? 41 : 27;
  return { x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r };
}

export function MatchConstellation({ creators }: { creators: CreatorCard[] }) {
  const list = creators.slice(0, 8);
  const [active, setActive] = useState(0);
  const pts = list.map((_, i) => place(i, list.length));
  const c = list[active];
  // creators who share a tool are linked by a faint edge
  const links: [number, number][] = [];
  list.forEach((a, i) => list.forEach((b, j) => {
    if (j > i && a.tools.some((t) => b.tools.some((u) => u.id === t.id))) links.push([i, j]);
  }));

  return (
    <ScrollSection
      id="match"
      eyebrow="Real creators"
      title={<>Every node is a <span className="star-text">real portfolio</span>.</>}
      lede="These are the most-followed creators on Creatora right now. Hover, focus or tap a star to see who's behind it."
    >
      {list.length === 0 ? (
        <div className="glass mt-12 flex flex-col items-center gap-3 rounded-[2rem] px-6 py-14 text-center">
          <ConstellationMark className="w-28 text-ink-3" />
          <p className="text-ink-2">Creators will appear here as they join.</p>
        </div>
      ) : (
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1.25fr_1fr]">
          <ScrollReveal className="relative mx-auto aspect-square w-full max-w-xl">
            <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible" aria-hidden>
              <g fill="none" stroke="currentColor" className="text-ink" strokeWidth="0.25">
                <circle cx="50" cy="50" r="27" strokeOpacity="0.14" />
                <circle cx="50" cy="50" r="41" strokeOpacity="0.1" strokeDasharray="0.6 1.6" />
                <circle cx="50" cy="50" r="48" strokeOpacity="0.06" />
              </g>
              {links.map(([a, b]) => (
                <line key={`${a}-${b}`} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} stroke="currentColor" className="text-ink" strokeOpacity={a === active || b === active ? 0.3 : 0.08} strokeWidth="0.25" />
              ))}
              {pts.map((p, i) => (
                <motion.line
                  key={i} x1="50" y1="50" x2={p.x} y2={p.y}
                  stroke={i === active ? "var(--amber)" : "currentColor"}
                  className={i === active ? undefined : "text-ink"}
                  strokeOpacity={i === active ? 0.9 : 0.12}
                  strokeWidth={i === active ? 0.45 : 0.25}
                  initial={false}
                  animate={{ pathLength: i === active ? [0, 1] : 1 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  style={i === active ? { filter: "drop-shadow(0 0 1.2px var(--glow))" } : undefined}
                />
              ))}
            </svg>
            <div className="absolute left-1/2 top-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-amber/40 bg-glass-strong text-center shadow-[0_0_50px_-10px_var(--glow)] backdrop-blur-xl">
              <span className="px-2 text-xs font-semibold leading-tight">Your<br />brief</span>
            </div>
            <ul aria-label="Creators">
              {list.map((cr, i) => (
                <li key={cr.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${pts[i].x}%`, top: `${pts[i].y}%` }}>
                  <button
                    type="button"
                    aria-pressed={i === active}
                    aria-label={`${cr.display_name}${cr.headline ? `, ${cr.headline}` : ""}`}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
                    onFocus={() => setActive(i)}
                    onClick={() => setActive(i)}
                    className={cn(
                      "grid place-items-center rounded-full p-0.5 transition-all duration-300",
                      i === active ? "scale-110 bg-amber shadow-[0_0_28px_-2px_var(--glow)]" : "bg-glass-border hover:bg-amber/60",
                    )}
                  >
                    <Avatar src={cr.avatar_url} name={cr.display_name} size="lg" className="[&>img]:size-10 [&>img]:ring-0 [&>span]:size-10 [&>span]:ring-0 sm:[&>img]:size-14 sm:[&>span]:size-14" />
                  </button>
                </li>
              ))}
            </ul>
          </ScrollReveal>

          <div aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.div key={c.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={SPRING}>
                <GlowCard className="p-6">
                  <div className="flex items-center gap-3">
                    <Avatar src={c.avatar_url} name={c.display_name} size="lg" verified={c.is_verified} />
                    <div className="min-w-0">
                      <h3 className="display truncate text-2xl">{c.display_name}</h3>
                      <p className="truncate text-sm text-ink-2">{c.headline ?? "AI creator"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    {c.is_verified && <VerifiedChip />}
                    {c.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{c.location}</span>}
                  </div>
                  <TrustBadges badges={c.badges} role="creator" className="mt-2" />
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    {([["Followers", c.followers_count], ["Pieces", c.posts_count], ["Likes", c.likes_count]] as const).map(([k, v]) => (
                      <div key={k} className="flex flex-col-reverse rounded-2xl bg-ink/[0.04] py-2">
                        <dt className="text-[11px] text-ink-3">{k}</dt>
                        <dd className="display text-xl tabular-nums">{compact(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  {c.tools.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">{c.tools.slice(0, 6).map((t) => <Chip key={t.id} tone="glass">{t.name}</Chip>)}</div>
                  )}
                  {c.preview.some((p) => p.url && p.media_type === "image") && (
                    <div className="mt-4 grid grid-cols-3 gap-1.5">
                      {c.preview.filter((p) => p.url && p.media_type === "image").slice(0, 3).map((p) => (
                        <img key={p.id} src={p.url!} alt={p.title} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                      ))}
                    </div>
                  )}
                  <Link href={`/u/${c.username}`} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold hover:text-amber-ink">
                    View profile <ArrowUpRight className="size-4" />
                  </Link>
                </GlowCard>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}
    </ScrollSection>
  );
}
