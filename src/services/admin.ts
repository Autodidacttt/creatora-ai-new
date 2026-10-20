import type { CampaignCard, MiniProfile, PostCard } from "@/types/app";
import type { AdminAction } from "@/lib/validation/schemas";
import { as, type DB, unwrap } from "./_db";

// Reads go through admin-only RPCs (each checks is_admin() in Postgres).
// Writes go through POST /api/admin, which re-checks the role server-side and writes the audit log.

export async function getAdminStats(db: DB) {
  return as<{
    creators: number; brands: number; admins: number; suspended: number; verified_creators: number;
    posts: number; removed_posts: number; campaigns: { draft: number; active: number; completed: number };
    applications: number; messages: number; likes: number; follows: number;
    pending_verifications: number; open_reports: number;
    signups_14d: { day: string; count: number }[]; top_tools: { name: string; count: number }[];
  }>(unwrap(await db.rpc("admin_stats")));
}

export async function listUsers(db: DB, opts: { query?: string; role?: string | null }, page = 0, size = 30) {
  const rows = unwrap(await db.rpc("admin_list_users", {
    p_query: opts.query || null, p_role: opts.role || null, p_limit: size, p_offset: page * size,
  }));
  return { items: rows, total: rows[0]?.total_count ?? 0 };
}

export async function listPosts(db: DB, opts: { query?: string; removed?: boolean | null }, page = 0, size = 30) {
  const rows = unwrap(await db.rpc("admin_list_posts", {
    p_query: opts.query || null, p_removed: opts.removed ?? null, p_limit: size, p_offset: page * size,
  }));
  return { items: rows.map((r) => ({ post: as<PostCard>(r.post), reports: r.reports })), total: rows[0]?.total_count ?? 0 };
}

export async function listVerifications(db: DB, status: string | null) {
  const rows = unwrap(await db.rpc("admin_list_verifications", { p_status: status }));
  return rows.map((r) => ({ ...r, creator: as<MiniProfile>(r.creator) }));
}

export async function listReports(db: DB, status: string | null) {
  const rows = unwrap(await db.rpc("admin_list_reports", { p_status: status }));
  return rows.map((r) => ({ ...r, reporter: as<MiniProfile>(r.reporter) }));
}

export async function listCampaigns(db: DB, status: string | null) {
  const rows = unwrap(await db.rpc("admin_list_campaigns", { p_status: status }));
  return rows.map((r) => as<CampaignCard>(r.campaign));
}

export async function auditLog(db: DB) {
  const rows = unwrap(await db.rpc("admin_audit_log", { p_limit: 60 }));
  return rows.map((r) => ({ ...r, actor: as<MiniProfile | null>(r.actor) }));
}

export async function runAdminAction(action: AdminAction) {
  const res = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Admin action failed");
}
