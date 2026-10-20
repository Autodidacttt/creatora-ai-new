"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Live countdown to a deadline. Renders a stable placeholder until mounted (no hydration mismatch). */
export function Countdown({ to, className, compact }: { to: string; className?: string; compact?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  const target = new Date(to).getTime();
  const left = now === null ? null : target - now;
  const closed = left !== null && left <= 0;
  const { h, m, s } = parts(left ?? 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span
      role="timer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
        closed ? "bg-ink/[0.06] text-ink-2" : left !== null && left < 6 * 3600_000 ? "bg-danger/10 text-danger" : "bg-amber-soft text-ink",
        className,
      )}
    >
      <Timer className="size-3.5" aria-hidden />
      {left === null ? "—" : closed ? "Closed" : compact ? `${h}h ${pad(m)}m left` : `${h}h ${pad(m)}m ${pad(s)}s left`}
    </span>
  );
}
