import type { InboxItem, Message, MiniProfile } from "@/types/app";
import { as, type DB, requireUserId, unwrap } from "./_db";

export async function getInbox(db: DB, opts: { otherRole?: "creator" | "brand" | null; query?: string } = {}, page = 0, size = 30) {
  const rows = unwrap(await db.rpc("get_inbox", {
    p_other_role: opts.otherRole ?? null, p_query: opts.query?.trim() || null, p_limit: size, p_offset: page * size,
  }));
  const items = rows.map((r) => ({ ...r, other: as<InboxItem["other"]>(r.other) })) as InboxItem[];
  return { items, total: rows[0]?.total_count ?? 0, nextPage: (page + 1) * size < (rows[0]?.total_count ?? 0) ? page + 1 : null };
}

/** Opens (or creates) the 1:1 conversation with another user. */
export async function openConversation(db: DB, otherUserId: string): Promise<string> {
  return unwrap(await db.rpc("get_or_create_dm", { p_other: otherUserId }));
}

export async function getConversationPeer(db: DB, conversationId: string): Promise<MiniProfile & { role: string }> {
  const me = await requireUserId(db);
  const rows = unwrap(await db.from("conversation_participants").select("user_id").eq("conversation_id", conversationId));
  const other = rows.find((r) => r.user_id !== me);
  if (!other) throw new Error("Conversation not found");
  return as<MiniProfile & { role: string }>(unwrap(await db.rpc("mini_profile", { p_id: other.user_id })));
}

/** Newest-first page of messages older than `before`. */
export async function getMessages(db: DB, conversationId: string, before?: string, size = 40): Promise<{ items: Message[]; hasMore: boolean }> {
  let q = db.from("messages").select("id, conversation_id, sender_id, body, kind, created_at")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(size);
  if (before) q = q.lt("created_at", before);
  const rows = unwrap(await q);
  return { items: rows.reverse() as Message[], hasMore: rows.length === size };
}

export async function sendMessage(db: DB, conversationId: string, body: string): Promise<Message> {
  const senderId = await requireUserId(db);
  return unwrap(await db.from("messages").insert({ conversation_id: conversationId, sender_id: senderId, body })
    .select("id, conversation_id, sender_id, body, kind, created_at").single());
}

export async function markConversationRead(db: DB, conversationId: string) {
  unwrap(await db.rpc("mark_conversation_read", { p_conversation: conversationId }));
}
