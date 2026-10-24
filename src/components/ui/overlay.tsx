"use client";

import type { ReactNode } from "react";
import { Dialog as D, DropdownMenu as DM, Popover as P, Tooltip as T } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { pressOrigin } from "@/components/cosmic/app-open";

/** Dialog content grows out of the control that opened it (transform-origin = that control, relative to the dialog). */
function growFromPress(el: HTMLElement | null) {
  const p = el && pressOrigin();
  if (!el || !p) return;
  const r = el.getBoundingClientRect();
  el.style.transformOrigin = `${p.x - r.left}px ${p.y - r.top}px`;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------
export function Dialog({ open, onOpenChange, title, description, children, className, size = "md", hideTitle }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  hideTitle?: boolean;
}) {
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-6xl" }[size];
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fade fixed inset-0 z-50 bg-[#080604]/65 backdrop-blur-sm" />
        <D.Content
          ref={growFromPress}
          className={cn(
            "glass-strong sheet fixed z-50 overflow-y-auto overscroll-contain focus:outline-none",
            // phones: a bottom sheet that rises from the edge; larger screens: a centred card that grows from the trigger
            "inset-x-0 bottom-0 mx-auto max-h-[90dvh] rounded-t-[1.75rem] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[92dvh] sm:w-[calc(100vw-1.5rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[2rem] sm:p-7",
            width,
            className,
          )}
        >
          <span aria-hidden className="mx-auto -mt-2 mb-3 block h-1 w-10 rounded-full bg-ink/20 sm:hidden" />
          <div className={cn("mb-4 flex items-start justify-between gap-4", hideTitle && "sr-only")}>
            <div>
              <D.Title className="display text-xl">{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-ink-2">{description}</D.Description>}
            </div>
          </div>
          {hideTitle && !description && <D.Description className="sr-only">{title}</D.Description>}
          {children}
          <D.Close asChild>
            <button aria-label="Close" className="press absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-card/80 text-ink-2 hover:text-ink">
              <X className="size-4" />
            </button>
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ---------------------------------------------------------------------------
// Dropdown menu
// ---------------------------------------------------------------------------
export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={8} className={cn("glass-strong glass-surface pop z-50 min-w-48 rounded-2xl p-1.5 [transform-origin:var(--radix-dropdown-menu-content-transform-origin)]", className)}>
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, onSelect, className, danger }: { children: ReactNode; onSelect?: () => void; className?: string; danger?: boolean }) {
  return (
    <DM.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-ink/[0.06] data-[highlighted]:[&_svg]:text-amber-ink [&_svg]:size-4",
        danger ? "text-danger" : "text-ink",
        className,
      )}
    >
      {children}
    </DM.Item>
  );
}
export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({ children, className, align = "start" }: { children: ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={8} collisionPadding={12} className={cn("glass-strong glass-surface pop z-50 rounded-2xl p-2 focus:outline-none [transform-origin:var(--radix-popover-content-transform-origin)]", className)}>
        {children}
      </P.Content>
    </P.Portal>
  );
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
export const TooltipProvider = T.Provider;
export function Tooltip({ content, children, side = "right" }: { content: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <T.Root delayDuration={150}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={10} className="z-50 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg shadow-lg">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
