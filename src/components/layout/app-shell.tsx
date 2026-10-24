"use client";

import type { ReactNode } from "react";
import { useMe } from "@/features/session";
import { navFor } from "@/config/nav";
import { useUnreadCounts } from "@/hooks/use-realtime";
import { BottomTabs, IconRail } from "./icon-rail";
import { TopBar } from "./top-bar";
import { VerificationBanner } from "@/components/verification/verification-banner";

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const unread = useUnreadCounts();
  const items = navFor(me.role, me.username);
  const create =
    me.role === "creator" ? { href: "/posts/new", label: "Add portfolio piece" }
    : me.role === "brand" ? { href: "/campaigns/new", label: "New brief" }
    : null;

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-amber focus:px-4 focus:py-2">
        Skip to content
      </a>
      <TopBar unreadNotifications={unread.notifications} />
      <IconRail items={items} unreadMessages={unread.messages} createHref={create?.href ?? null} createLabel={create?.label ?? ""} />
      <main id="main" className="mx-auto max-w-7xl px-3 pb-28 pt-5 sm:px-5 lg:pb-12 lg:pl-28">
        <VerificationBanner />
        {children}
      </main>
      <BottomTabs items={items} unreadMessages={unread.messages} />
    </>
  );
}
