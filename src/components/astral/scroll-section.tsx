import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ScrollReveal } from "./interactive";

/** Anchored page section with a revealed heading block (eyebrow · title · lede). Used by the landing chapters. */
export function ScrollSection({ id, eyebrow, title, lede, children, className, align = "left" }: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("relative scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32", className)}>
      <div className="mx-auto max-w-6xl">
        <ScrollReveal className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
          <p className={cn("eyebrow flex items-center gap-2", align === "center" && "justify-center")}>
            <span aria-hidden className="size-1 rounded-full bg-amber shadow-[0_0_8px_var(--glow)]" />
            {eyebrow}
          </p>
          <h2 id={`${id}-title`} className="display mt-3 text-4xl leading-[1.04] sm:text-5xl">{title}</h2>
          {lede && <p className="mt-4 text-base text-ink-2 sm:text-lg">{lede}</p>}
        </ScrollReveal>
        {children}
      </div>
    </section>
  );
}
