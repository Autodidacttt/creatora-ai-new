import { Briefcase, Compass, House, Layers, LayoutDashboard, Megaphone, MessageCircle, User, type LucideIcon } from "lucide-react";
import type { Role } from "@/types/app";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra path prefixes that should mark this item active */
  match?: string[];
  badge?: "messages";
}

export function navFor(role: Role, username: string): NavItem[] {
  const profile: NavItem = { label: "Profile", href: `/u/${username}`, icon: User, match: [`/u/${username}`, "/dashboard", "/settings", "/verification", "/saved", "/posts"] };
  const inbox: NavItem = { label: "Inbox", href: "/inbox", icon: MessageCircle, badge: "messages" };
  const home: NavItem = { label: "Home", href: "/home", icon: House };
  if (role === "brand") {
    return [
      home,
      { label: "Discover", href: "/discover", icon: Compass, match: ["/discover", "/swipe"] },
      { label: "Campaigns", href: "/campaigns", icon: Megaphone, match: ["/campaigns", "/brand"] },
      inbox,
      profile,
    ];
  }
  if (role === "admin") {
    return [
      { label: "Admin", href: "/admin", icon: LayoutDashboard, match: ["/admin"] },
      home,
      { label: "Discover", href: "/discover", icon: Compass },
      inbox,
      profile,
    ];
  }
  return [
    home,
    { label: "Swipe", href: "/swipe", icon: Layers, match: ["/swipe", "/discover"] },
    { label: "Opportunities", href: "/opportunities", icon: Briefcase, match: ["/opportunities", "/campaigns"] },
    inbox,
    profile,
  ];
}

export function isActive(item: NavItem, pathname: string) {
  const prefixes = item.match ?? [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
