"use client";

import { useEffect, useRef } from "react";
import { Switch as S } from "radix-ui";
import { cn } from "@/lib/utils";
import { AstralLoader } from "@/components/astral/ornaments";

/** Calls onVisible when scrolled near the bottom — drives infinite scroll. */
export function InfiniteSentinel({ onVisible, disabled, loading }: { onVisible: () => void; disabled?: boolean; loading?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  useEffect(() => { cb.current = onVisible; }, [onVisible]);
  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && cb.current(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [disabled]);
  return (
    <div ref={ref} className="flex h-16 items-center justify-center">
      {loading && <AstralLoader className="size-10" label="Loading more" />}
    </div>
  );
}

export function Switch({ checked, onCheckedChange, id, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; label?: string }) {
  return (
    <S.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-amber shadow-[0_0_14px_-2px_var(--glow)]" : "bg-ink/15")}
    >
      <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </S.Root>
  );
}
