"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "./button";
import { ConstellationMark } from "@/components/astral/ornaments";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("shimmer fx-motion rounded-2xl bg-ink/[0.06]", className)} />;
}

export function EmptyState({ icon, title, description, action, className }: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass relative flex flex-col items-center gap-3 overflow-hidden rounded-[2rem] px-6 py-12 text-center", className)}>
      <ConstellationMark className="pointer-events-none absolute -right-4 -top-2 w-40 text-ink-3 opacity-40" />
      {icon && <div className="relative grid size-14 place-items-center rounded-full bg-amber-soft text-ink ring-1 ring-amber/30 shadow-[0_0_30px_-6px_var(--glow)] [&_svg]:size-6">{icon}</div>}
      <h3 className="display text-lg">{title}</h3>
      {description && <div className="max-w-md text-sm text-ink-2">{description}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, title = "Couldn't load this" }: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  title?: string;
}) {
  return (
    <div role="alert" className={cn("glass flex flex-col items-center gap-3 rounded-[2rem] px-6 py-10 text-center", className)}>
      <div className="grid size-12 place-items-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <h3 className="display text-lg">{title}</h3>
      <p className="max-w-md text-sm text-ink-2">{errorMessage(error)}</p>
      {onRetry && (
        <Button onClick={onRetry} size="sm">
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}
