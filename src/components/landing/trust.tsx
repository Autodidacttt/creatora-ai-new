import { FileLock2, Fingerprint, Gauge, History, Phone, ScanEye, type LucideIcon } from "lucide-react";
import { ScrollSection } from "@/components/astral/scroll-section";
import { GlowCard, ScrollReveal } from "@/components/astral/interactive";
import { Geo } from "./geo";

const ITEMS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Phone, title: "Phone verification", body: "A one-time code confirms the number, and each number can be verified on only one account." },
  { icon: Fingerprint, title: "Identity review", body: "Government IDs are reviewed by the trust team. The automated check is advisory only." },
  { icon: ScanEye, title: "Company verification", body: "An official company contact confirms that a brand member may represent the company." },
  { icon: FileLock2, title: "Private originals", body: "Originals sit in a private bucket. Brands get clean files through a short-lived link, only after approval and payment release." },
  { icon: Gauge, title: "Honest scores", body: "Match scores measure relevance to a brief, never talent. AI review labels its estimates and never claims to detect AI." },
  { icon: History, title: "Audited decisions", body: "Every verification decision is audit-logged and the person involved is notified." },
];

export function TrustSection() {
  return (
    <ScrollSection
      id="trust"
      eyebrow="Trust & verification"
      title={<>Clear about <span className="star-text">who, what and how</span>.</>}
      lede="Every badge explains what was checked. Every payment step is logged. Nothing is hidden behind a score."
    >
      <Geo kind="shield" className="pointer-events-none absolute right-4 top-16 hidden size-72 opacity-60 lg:block" />
      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((it, i) => (
          <ScrollReveal as="li" key={it.title} delay={0.04 * i}>
            <GlowCard className="h-full p-6">
              <span className="grid size-11 place-items-center rounded-full bg-amber-soft ring-1 ring-amber/30 shadow-[0_0_24px_-8px_var(--glow)]">
                <it.icon className="size-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{it.title}</h3>
              <p className="mt-1.5 text-sm text-ink-2">{it.body}</p>
            </GlowCard>
          </ScrollReveal>
        ))}
      </ul>
    </ScrollSection>
  );
}
