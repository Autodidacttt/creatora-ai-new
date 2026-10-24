"use client";

import type { ReactNode } from "react";
import type { CreatorCard } from "@/types/app";
import { ScrollSection } from "@/components/astral/scroll-section";
import { GlowCard, Parallax, ScrollReveal } from "@/components/astral/interactive";
import { cn } from "@/lib/utils";
import { Geo, type GeoKind } from "./geo";
import { BriefPreview, DiscoveryPreview, FinderPreview, HiringPreview, PortfolioPreview, VerifiedPreview } from "./previews";
import type { PublicStats } from "./live-stats";

interface Chapter { kind: GeoKind; eyebrow: string; title: string; body: string; points: string[]; preview: ReactNode }

export function FeatureChapters({ creators, stats }: { creators: CreatorCard[]; stats: PublicStats | null }) {
  const chapters: Chapter[] = [
    {
      kind: "layers", eyebrow: "AI portfolios", title: "Show how the work was made",
      body: "Each piece records the tools, an ordered workflow, format and style, and whether it is cleared for commercial use.",
      points: ["Uploads or links from YouTube, Vimeo, Instagram, TikTok and Behance", "Tools with proficiency, rates and past brand work"],
      preview: <PortfolioPreview creator={creators.find((c) => c.preview.some((p) => p.url && p.media_type === "image"))} />,
    },
    {
      kind: "radar", eyebrow: "Discovery & filtering", title: "Find exactly the right style",
      body: "Search names, bios, posts, tools and skills, then combine filters. When nothing matches, Creatora shows which filter is costing you results.",
      points: ["Tools, skills, style, language, availability and verified-only", "Filters live in the URL, so searches can be shared"],
      preview: <DiscoveryPreview creators={creators} total={stats?.creators ?? null} />,
    },
    {
      kind: "mesh", eyebrow: "AI brief builder", title: "One sentence in, a full brief out",
      body: "Describe the job and get a structured brief with formats, platforms, budget and usage rights. Every field stays editable, and the AI's assumptions are listed.",
      points: ["Commercial terms: territory, duration, exclusivity and AI disclosure", "A manual form is always available"],
      preview: <BriefPreview />,
    },
    {
      kind: "orbit", eyebrow: "Creator finder", title: "Matches that explain themselves",
      body: "Creators are ranked for each brief from tools, portfolio, skills, experience, fit and availability, and every factor is shown.",
      points: ["A 'Why this creator?' line on every match", "Swipe, shortlist and contact from the results"],
      preview: <FinderPreview />,
    },
    {
      kind: "shield", eyebrow: "Verified identities", title: "Badges that say what was checked",
      body: "Phone, identity and company checks each come with a plain explanation of what was verified and how.",
      points: ["IDs are reviewed by the trust team; images stay private and are deleted after a retention period", "One phone number per account"],
      preview: <VerifiedPreview />,
    },
    {
      kind: "chain", eyebrow: "Secure hiring & delivery", title: "Hire, fund, review, release",
      body: "Agree a fee, fund the project and review watermarked previews. Clean files and a licence record unlock when the payment is released.",
      points: ["Escrow ledger in test mode. No real money moves", "Approve, request a revision or reject, with notifications at every step"],
      preview: <HiringPreview />,
    },
  ];

  return (
    <ScrollSection
      id="features"
      eyebrow="Features"
      title={<>Everything between a brief and a <span className="star-text">finished file</span>.</>}
      lede="Six features, each shown below with the component it uses in the app."
    >
      <div className="mt-16 space-y-20 sm:space-y-28">
        {chapters.map((c, i) => (
          <article key={c.eyebrow} aria-labelledby={`feat-${i}`} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
            <ScrollReveal className={cn(i % 2 && "lg:order-2")}>
              <p className="eyebrow">{String(i + 1).padStart(2, "0")} · {c.eyebrow}</p>
              <h3 id={`feat-${i}`} className="display mt-2 text-3xl sm:text-4xl">{c.title}</h3>
              <p className="mt-3 text-ink-2">{c.body}</p>
              <ul className="mt-5 space-y-2">
                {c.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-sm text-ink-2">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-amber shadow-[0_0_8px_var(--glow)]" />
                    {p}
                  </li>
                ))}
              </ul>
            </ScrollReveal>
            <ScrollReveal delay={0.08}>
              <GlowCard tilt className="relative min-h-[22rem] p-5 sm:p-8">
                <Parallax speed={0.12} className="pointer-events-none absolute -right-10 -top-10 size-64 opacity-90">
                  <Geo kind={c.kind} className="size-full" />
                </Parallax>
                <div className="relative mx-auto mt-16 max-w-sm sm:mt-20">{c.preview}</div>
              </GlowCard>
            </ScrollReveal>
          </article>
        ))}
      </div>
    </ScrollSection>
  );
}
