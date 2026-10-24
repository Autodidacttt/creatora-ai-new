import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-ink/[0.06] text-ink",
  glass: "bg-glass-strong text-ink border border-glass-border",
  amber: "bg-amber-soft text-ink border border-amber/40",
  solid: "bg-amber text-on-amber",
  dark: "bg-ink text-bg",
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  outline: "border border-line text-ink-2",
};

export function Chip({ children, tone = "neutral", className, icon }: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium [&_svg]:size-3.5", TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function VerifiedChip({ label = "Verified", className }: { label?: string; className?: string }) {
  return (
    <Chip tone="amber" icon={<BadgeCheck className="fill-amber text-on-amber" />} className={className}>
      {label}
    </Chip>
  );
}

/** Toggleable chip used for multi-choice inputs (formats, rights, etc). */
export function ToggleChip({ selected, onClick, children, disabled }: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-all disabled:opacity-50",
        selected ? "border-amber bg-amber text-on-amber shadow-[0_0_14px_-4px_var(--glow)]" : "border-line bg-card text-ink hover:border-amber/40",
      )}
    >
      {children}
    </button>
  );
}
