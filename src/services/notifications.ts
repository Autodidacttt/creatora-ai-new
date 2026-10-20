import type { MiniProfile, NotificationItem } from "@/types/app";
import { as, type DB, requireUserId, unwrap } from "./_db";

export async function getNotifications(db: DB, page = 0, size = 20) {
  const rows = unwrap(await db.rpc("get_notifications", { p_limit: size, p_offset: page * size }));
  const items: NotificationItem[] = rows.map((r) => ({
    id: r.id,
    type: r.type as NotificationItem["type"],
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    data: as<NotificationItem["data"]>(r.data),
    read_at: r.read_at,
    created_at: r.created_at,
    actor: as<MiniProfile | null>(r.actor),
  }));
  const total = rows[0]?.total_count ?? 0;
  return { items, total, nextPage: (page + 1) * size < total ? page + 1 : null };
}

export async function getUnreadCounts(db: DB): Promise<{ notifications: number; messages: number }> {
  return as<{ notifications: number; messages: number }>(unwrap(await db.rpc("get_unread_counts")));
}

export async function markNotificationRead(db: DB, id: string) {
  unwrap(await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id));
}

export async function markAllNotificationsRead(db: DB) {
  const userId = await requireUserId(db);
  unwrap(await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null));
}

/** Where a notification should take the user. */
export function notificationHref(n: NotificationItem, role: string): string {
  switch (n.type) {
    case "follow":
      return n.actor ? `/u/${n.actor.username}` : "/home";
    case "like":
    case "comment":
      return n.entity_id ? `/post/${n.entity_id}` : "/home";
    case "application":
      return n.entity_id ? `/campaigns/${n.entity_id}?tab=applications` : "/campaigns";
    case "shortlisted":
    case "selected":
      return n.entity_id ? `/campaigns/${n.entity_id}` : role === "creator" ? "/opportunities" : "/campaigns";
    case "message":
      return n.entity_id ? `/inbox/${n.entity_id}` : "/inbox";
    case "verification":
      return "/verification";
    default:
      return "/home";
  }
}

export function notificationText(n: NotificationItem): string {
  const who = n.actor?.display_name ?? "Someone";
  const d = n.data ?? {};
  switch (n.type) {
    case "follow": return `${who} started following you`;
    case "like": return `${who} liked “${d.post_title ?? "your post"}”`;
    case "comment": return `${who} commented on “${d.post_title ?? "your post"}”: ${d.excerpt ?? ""}`;
    case "application": return `${who} applied to “${d.campaign_title ?? "your brief"}”`;
    case "shortlisted": return `${who} shortlisted you for “${d.campaign_title ?? "a brief"}”`;
    case "selected": return `${who} selected you for “${d.campaign_title ?? "a brief"}” 🎉`;
    case "message": {
      const count = Number(d.count ?? 1);
      return count > 1 ? `${who} sent you ${count} messages` : `${who}: ${d.excerpt ?? "sent you a message"}`;
    }
    case "verification": return `Your verification “${d.title ?? ""}” was ${d.status === "approved" ? "approved ✓" : "not approved"}`;
    default: return "New activity";
  }
}
