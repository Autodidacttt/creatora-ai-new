import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const GlassPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { strong?: boolean }>(
  function GlassPanel({ className, strong, ...props }, ref) {
    return <div ref={ref} className={cn(strong ? "glass-strong" : "glass", "rounded-[2rem]", className)} {...props} />;
  },
);

export function SectionTitle({ eyebrow, title, action, className }: {
  eyebrow?: string;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div>
        {eyebrow && (
          <p className="eyebrow mb-1 flex items-center gap-2">
            <span aria-hidden className="size-1 rounded-full bg-amber shadow-[0_0_8px_var(--glow)]" />
            {eyebrow}
          </p>
        )}
        <h2 className="display text-xl sm:text-2xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}
