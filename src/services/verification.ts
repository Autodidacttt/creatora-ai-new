import type { Verification } from "@/types/app";
import { type DB, requireUserId, unwrap } from "./_db";

export async function getMyVerifications(db: DB): Promise<Verification[]> {
  const userId = await requireUserId(db);
  const rows = unwrap(await db.from("verifications")
    .select("id, type, title, status, evidence_url, evidence_notes, tool_id, post_id, experience_id, reviewed_at, created_at")
    .eq("creator_id", userId).order("created_at", { ascending: false }));
  return rows as Verification[];
}

export async function requestVerification(
  db: DB,
  values: {
    type: Verification["type"];
    title: string;
    tool_id?: number | null;
    post_id?: string | null;
    experience_id?: string | null;
    evidence_url?: string | null;
    evidence_notes?: string | null;
  },
) {
  const userId = await requireUserId(db);
  unwrap(await db.from("verifications").insert({
    creator_id: userId,
    type: values.type,
    title: values.title,
    tool_id: values.type === "tool" ? values.tool_id ?? null : null,
    post_id: values.type === "workflow" ? values.post_id ?? null : null,
    experience_id: values.type === "past_work" ? values.experience_id ?? null : null,
    evidence_url: values.evidence_url ?? null,
    evidence_notes: values.evidence_notes ?? null,
  }));
}

export async function withdrawVerification(db: DB, id: string) {
  unwrap(await db.from("verifications").delete().eq("id", id));
}
