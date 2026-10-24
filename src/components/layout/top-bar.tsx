"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bookmark, LogOut, Search, Settings, ShieldCheck, Sparkles, User, LayoutDashboard } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";
import { useScrolled } from "@/components/cosmic/use-scrolled";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("display flex items-center gap-2 text-xl", className)}>
      <span aria-hidden className="grid size-8 place-items-center rounded-full bg-amber text-sm text-on-amber shadow-[0_0_20px_var(--glow)]">
        ✦
      </span>
      creatora
    </span>
  );
}

export function TopBar({ unreadNotifications }: { unreadNotifications: number }) {
  const me = useMe();
  const db = useDb();
  const router = useRouter();
  const scrolled = useScrolled();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const firstName = me.display_name.split(" ")[0];

  async function signOut() {
    await db.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    // Scroll-linked: transparent over the sky at the top, glass (blur, grain, hairline) once content passes under it
    <header
      className={cn(
        "sticky top-0 z-30 px-3 pb-2 pt-3 transition-[background-color,backdrop-filter,box-shadow] duration-500 sm:px-5 lg:pl-28",
        scrolled ? "bg-bg/60 bg-[image:var(--grain)] shadow-[0_12px_30px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl backdrop-saturate-150" : "bg-transparent",
      )}
    >
      <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--glass-border-hi)] to-transparent transition-opacity duration-500", scrolled ? "opacity-100" : "opacity-0")} />
      <div className="mx-auto flex max-w-7xl items-center gap-2 sm:gap-3">
        <Link href="/home" className="mr-auto shrink-0 rounded-full focus-visible:outline-offset-4" aria-label="Creatora home">
          <Wordmark />
        </Link>

        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/discover${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
          }}
          className={cn(
            "glass hidden h-11 items-center gap-2 rounded-full px-4 transition-all duration-300 sm:flex",
            focused ? "w-80 ring-4 ring-amber/30" : "w-56",
          )}
        >
          <Search className="size-4 text-ink-3" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search creators, tools…"
            aria-label="Search creators"
            className="w-full bg-transparent text-sm placeholder:text-ink-3 focus:outline-none"
          />
        </form>
        <Link href="/discover" aria-label="Search" className="glass grid size-11 place-items-center rounded-full sm:hidden">
          <Search className="size-5" />
        </Link>

        <NotificationBell unread={unreadNotifications} />

        <Menu>
          <MenuTrigger asChild>
            <button className="glass flex h-11 items-center gap-2 rounded-full pl-1 pr-1 sm:pr-4" aria-label="Account menu">
              <Avatar src={me.avatar_url} name={me.display_name} size="md" className="[&>img]:size-9 [&>span:first-child]:size-9" verified={me.is_verified} />
              <span className="hidden text-sm sm:inline">
                Hi, <span className="font-semibold">{firstName}</span>
              </span>
            </button>
          </MenuTrigger>
          <MenuContent>
            <div className="px-3 pb-2 pt-1.5">
              <p className="text-sm font-semibold">{me.display_name}</p>
              <p className="text-xs capitalize text-ink-3">@{me.username} · {me.role}</p>
            </div>
            <MenuSeparator />
            <MenuItem onSelect={() => router.push(`/u/${me.username}`)}><User /> My profile</MenuItem>
            <MenuItem onSelect={() => router.push("/settings/profile")}><Settings /> Edit profile</MenuItem>
            <MenuItem onSelect={() => router.push("/saved")}><Bookmark /> Saved</MenuItem>
            {me.role === "creator" && (
              <MenuItem onSelect={() => router.push("/verification")}><ShieldCheck /> Verification</MenuItem>
            )}
            {me.role === "admin" && (
              <MenuItem onSelect={() => router.push("/admin")}><LayoutDashboard /> Admin dashboard</MenuItem>
            )}
            <MenuItem onSelect={() => router.push("/settings/profile#effects")}><Sparkles /> Effects</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={signOut} danger><LogOut /> Sign out</MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </header>
  );
}
