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
      if (role === "admin" && n.entity_id && /^(company_|invitation_)/.test(String(n.data?.event))) return `/admin/verifications/company/${n.entity_id}`;
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
    case "proposal":
      // Negotiation steps live in the campaign conversation
      return n.entity_id ? `/inbox/${n.entity_id}` : "/inbox";
    case "task":
      if (!n.entity_id) return role === "creator" ? "/opportunities?tab=projects" : "/campaigns";
      return role === "creator" ? `/opportunities/projects/${n.entity_id}` : `/brand/campaigns/projects/${n.entity_id}`;
    default:
      return "/home";
  }
}

const PROJECT_TEXT: Record<string, (who: string, t: string, d: NotificationItem["data"]) => string> = {
  hired: (who, t, d) => `${who} hired you for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""} 🎉`,
  awaiting_funding: (who, t, d) => `${who} hired you for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""} — work starts once they fund the project`,
  funding_required: (_who, t, d) => `Fund “${t}”${d.amount_label ? ` (${d.amount_label})` : ""} so your creator can start`,
  in_progress: (who, t, d) => (d.funded ? `${who} funded “${t}” — you can start work` : `${who} started work on “${t}”`),
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
const PROPOSAL_TEXT: Record<string, (who: string, t: string, d: NotificationItem["data"]) => string> = {
  negotiation_opened: (who, t) => `${who} wants to hire you for “${t}” — agree the terms in chat`,
  offer: (who, t, d) => `${who} sent an offer for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""}`,
  offer_accepted: (who, t, d) => `${who} accepted your offer for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""} — terms agreed`,
  offer_accepted_hire: (who, t, d) => `${who} accepted your offer for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""} — hire them now`,
  proposal_sent: (who, t, d) => `${who} sent final proposal v${d.version ?? 1} for “${t}” — review and accept to hire`,
  proposal_accepted: (who, t, d) => `${who} accepted your proposal — you're hired for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""} 🎉`,
  proposal_rejected: (who, t, d) => `${who} declined proposal v${d.version ?? 1} for “${t}”`,
  hired_confirmed: (_who, t, d) => `Hire confirmed for “${t}”${d.amount_label ? ` · ${d.amount_label}` : ""}`,
};
const VERIFICATION_TEXT: Record<string, (d: NotificationItem["data"]) => string> = {
  phone_verified: () => "Your phone number is verified ✓",
  identity_pending: () => "Your ID verification was submitted — the trust team will review it",
  identity_verified: () => "Your identity is verified ✓ — the Identity Verified badge is on your profile",
  identity_rejected: (d) => `Your ID verification wasn't approved${d.reason ? `: ${d.reason}` : ""}`,
  company_pending: () => "Company Verification Pending — we're confirming with an official company contact",
  company_verified: (d) => `${d.company_name ?? "Your company"} is a Verified Company ✓ — you can publish briefs and hire`,
  company_rejected: () => "Verification rejected. If you think this is a mistake, contact support.",
  company_impersonation: (d) => `Potential impersonation: the contact for ${d.company_name ?? "a company"} did not confirm the applicant (high-priority report opened)`,
  invitation_demo: (d) => `Company invitation for ${d.company_name ?? "a company"} created — Demo, email not sent`,
};

const TASK_TEXT: Record<string, (who: string, t: string, d: NotificationItem["data"]) => string> = {
  task_assigned: (who, t, d) => `${who} assigned ${d.scope === "group" ? "a group task" : "you a task"} on “${t}”: ${d.title ?? ""}`,
  task_todo: (who, t, d) => `${who} moved “${d.title ?? "a task"}” back to to-do on “${t}”`,
  task_in_progress: (who, t, d) => `${who} started “${d.title ?? "a task"}” on “${t}”`,
  task_done: (who, t, d) => `${who} finished “${d.title ?? "a task"}” on “${t}” ✓`,
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
    case "verification": {
      const text = VERIFICATION_TEXT[String(d.event)];
      if (text) return text(d);
      return `Your verification “${d.title ?? ""}” was ${d.status === "approved" ? "approved ✓" : "not approved"}`;
    }
    case "project": {
      const fn = PROJECT_TEXT[String(d.event)];
      return fn ? fn(who, String(d.campaign_title ?? "a project"), d) : `Update on “${d.campaign_title ?? "a project"}”`;
    }
    case "payment": {
      const fn = PAYMENT_TEXT[String(d.event)];
      return fn ? fn(who, String(d.campaign_title ?? "a project"), d) : `Payment update on “${d.campaign_title ?? "a project"}”`;
    }
    case "proposal": {
      const fn = PROPOSAL_TEXT[String(d.event)];
      return fn ? fn(who, String(d.campaign_title ?? "a brief"), d) : `Hiring update on “${d.campaign_title ?? "a brief"}”`;
    }
    case "task": {
      const fn = TASK_TEXT[String(d.event)];
      return fn ? fn(who, String(d.campaign_title ?? "a brief"), d) : `Task update on “${d.campaign_title ?? "a brief"}”`;
    }
    case "opportunity":
      // Invites were removed; older invite notifications read as the brief being shared with you
      return d.invited
        ? `${who} shared the brief “${d.campaign_title ?? "a brief"}” with you`
        : `New brief that matches your work: “${d.campaign_title ?? ""}”${d.score ? ` (${d.score}% relevance)` : ""}`;
    default: return "New activity";
  }
}
