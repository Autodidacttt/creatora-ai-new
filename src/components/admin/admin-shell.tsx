"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { BadgeCheck, ClipboardList, FileImage, Flag, LayoutDashboard, Megaphone, Users } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { useUnreadCounts } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { SPRING } from "@/lib/motion";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/verifications", label: "Verifications", icon: BadgeCheck },
  { href: "/admin/content", label: "Content", icon: FileImage },
  { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/admin/reports", label: "Reports", icon: Flag },
  { href: "/admin/audit", label: "Audit log", icon: ClipboardList },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const unread = useUnreadCounts();
  return (
    <>
      <TopBar unreadNotifications={unread.notifications} />
      <div className="mx-auto grid max-w-7xl gap-5 px-3 pb-12 pt-5 sm:px-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Admin" className="glass-strong glass-surface h-fit rounded-[2rem] p-2 lg:sticky lg:top-24">
          <p className="eyebrow px-3 pb-2 pt-2">Admin</p>
          <ul className="flex gap-1 overflow-x-auto scrollbar-none lg:flex-col">
            {NAV.map((n) => {
              const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
              return (
                <li key={n.href} className="shrink-0">
                  <Link href={n.href} aria-current={active ? "page" : undefined}
                    className={cn("relative flex items-center gap-2.5 rounded-full px-3 py-2 text-sm transition-[color,scale] duration-300 ease-[var(--spring-glide)] active:scale-[0.96]", active ? "text-on-amber" : "hover:bg-ink/5")}>
                    {active && <motion.span layoutId="admin-active" className="absolute inset-0 rounded-full bg-amber shadow-[0_0_18px_-4px_var(--glow)]" transition={SPRING.glide} />}
                    <n.icon className="relative size-4" /> <span className="relative">{n.label}</span>
                  </Link>
                </li>
              );
            })}
            <li className="shrink-0 lg:mt-2 lg:border-t lg:border-line lg:pt-2">
              <Link href="/home" className="flex items-center gap-2.5 rounded-full px-3 py-2 text-sm text-ink-2 hover:bg-ink/5">← Back to app</Link>
            </li>
          </ul>
        </nav>
        <main id="main" className="min-w-0">{children}</main>
      </div>
    </>
  );
}
