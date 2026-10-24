"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { isActive, type NavItem } from "@/config/nav";
import { Tooltip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

/** Floating vertical rail (desktop). Active item is filled amber with a soft glow. */
export function IconRail({ items, unreadMessages, createHref, createLabel }: {
  items: NavItem[];
  unreadMessages: number;
  createHref: string | null;
  createLabel: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed left-5 top-1/2 z-40 hidden -translate-y-1/2 lg:block">
      <div className="glass flex flex-col items-center gap-3 rounded-full p-2.5">
        {items.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <Tooltip key={item.href} content={item.label}>
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative grid size-12 place-items-center rounded-full transition-all duration-200 hover:scale-110",
                  active ? "text-on-amber" : "bg-card text-ink shadow-sm hover:text-amber-ink hover:shadow-[0_0_0_1px_rgba(var(--glow-rgb),0.3),0_8px_24px_-10px_var(--glow)] dark:bg-transparent dark:text-ink-2 dark:shadow-none dark:hover:bg-ink/5 dark:hover:text-ink",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="rail-active"
                    className="absolute inset-0 rounded-full bg-amber shadow-[0_0_24px_var(--glow)]"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon className="relative size-5" strokeWidth={active ? 2.2 : 1.8} />
                {item.badge === "messages" && unreadMessages > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-ink px-1 text-[10px] font-semibold text-bg">
                    {unreadMessages > 9 ? "9+" : unreadMessages}
                  </span>
                )}
              </Link>
            </Tooltip>
          );
        })}
        {createHref && (
          <>
            <span className="h-px w-8 bg-line" aria-hidden />
            <Tooltip content={createLabel}>
              <Link
                href={createHref}
                aria-label={createLabel}
                className="grid size-12 place-items-center rounded-full bg-ink text-bg transition-transform hover:rotate-90 hover:scale-110"
              >
                <Plus className="size-5" />
              </Link>
            </Tooltip>
          </>
        )}
      </div>
    </nav>
  );
}

/** Bottom tab bar (mobile / tablet). */
export function BottomTabs({ items, unreadMessages }: { items: NavItem[]; unreadMessages: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-3 bottom-3 z-40 lg:hidden">
      <div className="glass-strong mx-auto flex max-w-md items-center justify-around rounded-full px-2 py-2">
        {items.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                // 6 items on the brand bar: a touch smaller on the narrowest phones so the bar never overflows
                "relative grid size-10 place-items-center rounded-full transition-colors min-[380px]:size-11",
                active ? "bg-amber text-on-amber shadow-[0_0_18px_var(--glow)]" : "text-ink-2",
              )}
            >
              <Icon className="size-5" />
              {item.badge === "messages" && unreadMessages > 0 && (
                <span className="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-card" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
