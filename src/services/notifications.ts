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
    case "project":
    case "payment": {
      if (!n.entity_id) return role === "creator" ? "/opportunities?tab=projects" : "/campaigns";
      if (role === "creator") return `/opportunities/projects/${n.entity_id}`;
      const sub = typeof n.data?.submission_id === "string" ? n.data.submission_id : null;
      if (sub && ["submitted", "resubmitted"].includes(String(n.data?.event))) return `/brand/campaigns/review?submission=${sub}`;
      return `/brand/campaigns/projects/${n.entity_id}`;
    }
    case "opportunity":
      return n.entity_id ? `/campaigns/${n.entity_id}` : "/opportunities";
    default:
      return "/home";
  }
}

const PROJECT_TEXT: Record<string, (who: string, t: string, d: NotificationItem["data"]) => string> = {
  hired: (who, t, d) => `${who} hired you for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""} 🎉`,
  in_progress: (who, t) => `${who} started work on “${t}”`,
  submitted: (who, t, d) => `${who} submitted version ${d.version ?? 1} of “${t}” for review`,
  resubmitted: (who, t, d) => `${who} submitted revised version ${d.version ?? ""} of “${t}”`,
  revision_requested: (who, t, d) => `${who} requested a revision on “${t}”${d.note ? `: ${d.note}` : ""}`,
  approved: (who, t, d) => `${who} approved version ${d.version ?? ""} of “${t}” ✓`,
  completed: (_who, t) => `“${t}” is complete`,
  rejected: (who, t) => `${who} rejected the submission for “${t}”`,
  cancelled: (who, t) => `${who} cancelled the project “${t}”`,
  issued: (_who, t, d) => `Licence record ${d.certificate_id ?? ""} issued for “${t}”`,
};
const PAYMENT_TEXT: Record<string, (who: string, t: string, d: NotificationItem["data"]) => string> = {
  funded: (who, t, d) => `${who} funded escrow for “${t}” · ${d.amount_label ?? ""} (test mode)`,
  released: (who, t, d) => `${who} released payment for “${t}” · ${d.amount_label ?? ""} (test mode)`,
  refunded: (_who, t) => `Escrow for “${t}” was refunded (test mode)`,
  disputed: (who, t) => `${who} opened a payment dispute on “${t}”`,
};

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
    case "project": {
      const fn = PROJECT_TEXT[String(d.event)];
      return fn ? fn(who, String(d.campaign_title ?? "a project"), d) : `Update on “${d.campaign_title ?? "a project"}”`;
    }
    case "payment": {
      const fn = PAYMENT_TEXT[String(d.event)];
      return fn ? fn(who, String(d.campaign_title ?? "a project"), d) : `Payment update on “${d.campaign_title ?? "a project"}”`;
    }
    case "opportunity":
      return d.invited
        ? `${who} invited you to “${d.campaign_title ?? "a brief"}”${d.note ? `: ${d.note}` : ""}`
        : `New brief that matches your work: “${d.campaign_title ?? ""}”${d.score ? ` (${d.score}% relevance)` : ""}`;
    default: return "New activity";
  }
}
