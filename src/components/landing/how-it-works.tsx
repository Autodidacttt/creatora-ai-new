"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import { Download, FileText, MessagesSquare, Sparkles, UserRound, Wallet, type LucideIcon } from "lucide-react";
import { ScrollSection } from "@/components/astral/scroll-section";
import { ScrollReveal, SPRING } from "@/components/astral/interactive";
import { cn } from "@/lib/utils";

const STEPS: { title: string; body: string; who: string; icon: LucideIcon }[] = [
  { title: "Create profile & portfolio", who: "Creator", icon: UserRound, body: "Every piece lists the tools, models and workflow behind it, with format and commercial-use clearance." },
  { title: "Brand posts a brief", who: "Brand", icon: FileText, body: "One sentence becomes a structured brief: format, style, platforms, budget and usage rights." },
  { title: "AI matching", who: "Creatora", icon: Sparkles, body: "Creators are ranked 0–100 for the brief, and every match says why, factor by factor." },
  { title: "Chat & negotiate", who: "Both", icon: MessagesSquare, body: "Realtime messages. Agree the fee and scope before anyone is hired." },
  { title: "Fund & deliver", who: "Both", icon: Wallet, body: "The brand funds the project in test mode. The creator submits work as watermarked previews." },
  { title: "Pay & download", who: "Brand", icon: Download, body: "Approve, release the payment and download clean originals with a licence record." },
];

// Constellation layout for the pinned diagram (viewBox 600 × 520)
const NODES: [number, number][] = [[70, 420], [170, 230], [300, 340], [395, 140], [500, 290], [540, 455]];

export function HowItWorks() {
  return (
    <ScrollSection
      id="how"
      eyebrow="How it works"
      title={<>From portfolio to paid, <span className="star-text">one constellation</span>.</>}
      lede="Six steps connect a creator and a brand. Each one is a real screen in the app."
    >
      <div className="fx-pin"><Pinned /></div>
      <div className="fx-stack"><Stacked /></div>
    </ScrollSection>
  );
}

/** Desktop + full effects: the section pins while scroll draws each connection in turn. */
function Pinned() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const s = useTransform(scrollYProgress, [0.05, 0.92], [0, STEPS.length - 1], { clamp: true });
  const [active, setActive] = useState(0);
  useMotionValueEvent(s, "change", (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.round(v)))));
  const step = STEPS[active];

  return (
    <div ref={ref} className="relative h-[420vh]">
      <div className="sticky top-0 grid h-svh items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <ol className="space-y-1.5">
            {STEPS.map((st, i) => (
              <li key={st.title} className={cn("flex items-center gap-3 text-sm transition-colors duration-300", i === active ? "text-ink" : i < active ? "text-ink-2" : "text-ink-3")}>
                <span className={cn("grid size-6 place-items-center rounded-full border text-[11px] tabular-nums transition-all duration-300",
                  i <= active ? "border-amber bg-amber text-on-amber shadow-[0_0_14px_-2px_var(--glow)]" : "border-line")}>{i + 1}</span>
                {st.title}
              </li>
            ))}
          </ol>
          <div className="relative mt-8 min-h-48">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                transition={{ ...SPRING, filter: { duration: 0.25 } }}
                className="glass rounded-[1.75rem] p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-full bg-amber-soft ring-1 ring-amber/30"><step.icon className="size-5" /></span>
                  <div>
                    <p className="eyebrow">Step {active + 1} · {step.who}</p>
                    <h3 className="display text-2xl">{step.title}</h3>
                  </div>
                </div>
                <p className="mt-4 text-ink-2">{step.body}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <StepDiagram s={s} active={active} />
      </div>
    </div>
  );
}

function StepDiagram({ s, active }: { s: MotionValue<number>; active: number }) {
  return (
    <svg viewBox="0 0 600 520" className="w-full overflow-visible" aria-hidden>
      {/* faint geometry behind the constellation */}
      <g fill="none" stroke="currentColor" className="text-ink" strokeOpacity="0.07" strokeWidth="0.8">
        <circle cx="300" cy="280" r="230" strokeDasharray="2 7" />
        <circle cx="300" cy="280" r="150" />
        <polygon points="300,60 510,420 90,420" />
        <polygon points="300,470 140,180 460,180" strokeOpacity="0.5" />
      </g>
      {NODES.slice(1).map(([x, y], i) => <Edge key={i} from={NODES[i]} to={[x, y]} s={s} i={i} />)}
      {NODES.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={22} className="fill-amber transition-opacity duration-500" opacity={i <= active ? 0.14 : 0} />
          {i === active && (
            <circle cx={x} cy={y} r={10} fill="none" stroke="var(--amber)" strokeWidth="1" className="fx-motion origin-center [animation:ping_2s_cubic-bezier(0,0,0.2,1)_infinite] [transform-box:fill-box]" />
          )}
          <circle cx={x} cy={y} r={i <= active ? 6 : 4} className={cn("transition-all duration-500", i <= active ? "fill-amber" : "fill-ink-3")} />
          <text x={x} y={y - 18} textAnchor="middle" className={cn("text-[13px] font-medium transition-colors duration-500", i <= active ? "fill-ink" : "fill-ink-3")}>
            {STEPS[i].title}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Edge({ from, to, s, i }: { from: [number, number]; to: [number, number]; s: MotionValue<number>; i: number }) {
  const pathLength = useTransform(s, [i, i + 1], [0, 1], { clamp: true });
  const d = `M${from[0]} ${from[1]} L${to[0]} ${to[1]}`;
  return (
    <>
      <path d={d} stroke="currentColor" className="text-ink" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="3 5" />
      <motion.path d={d} stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" fill="none" style={{ pathLength, filter: "drop-shadow(0 0 4px var(--glow))" }} />
    </>
  );
}

/** Mobile / reduced effects: no pinning — a vertical constellation that reveals as it scrolls past. */
function Stacked() {
  return (
    <ol className="relative mt-12 space-y-4 pl-10">
      <span aria-hidden className="absolute bottom-6 left-[15px] top-6 w-px bg-gradient-to-b from-amber/70 via-line to-amber/40" />
      {STEPS.map((st, i) => (
        <ScrollReveal as="li" key={st.title} delay={0.03 * i} className="relative">
          <span aria-hidden className="absolute -left-10 top-5 grid size-[31px] place-items-center rounded-full border border-amber/50 bg-bg text-xs font-semibold tabular-nums text-ink shadow-[0_0_16px_-4px_var(--glow)]">{i + 1}</span>
          <div className="glass rounded-[1.5rem] p-5">
            <p className="eyebrow">{st.who}</p>
            <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold"><st.icon className="size-4 text-amber-ink" /> {st.title}</h3>
            <p className="mt-1.5 text-sm text-ink-2">{st.body}</p>
          </div>
        </ScrollReveal>
      ))}
    </ol>
  );
}
