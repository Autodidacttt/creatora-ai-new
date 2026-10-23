import type { ConversationInfo, InboxItem, Message, Negotiation, OfferTerms } from "@/types/app";
import type { Json } from "@/types/database";
import { as, type DB, requireUserId, unwrap } from "./_db";

export async function getInbox(db: DB, opts: { otherRole?: "creator" | "brand" | null; query?: string } = {}, page = 0, size = 30) {
  const rows = unwrap(await db.rpc("get_inbox", {
    p_other_role: opts.otherRole ?? null, p_query: opts.query?.trim() || null, p_limit: size, p_offset: page * size,
  }));
  const items = rows.map((r) => ({
    ...r, other: as<InboxItem["other"]>(r.other), campaign: as<InboxItem["campaign"]>(r.campaign),
    conversation_type: r.conversation_type as InboxItem["conversation_type"],
  })) as InboxItem[];
  return { items, total: rows[0]?.total_count ?? 0, nextPage: (page + 1) * size < (rows[0]?.total_count ?? 0) ? page + 1 : null };
}

/** Opens (or creates) the 1:1 conversation with another user. */
export async function openConversation(db: DB, otherUserId: string): Promise<string> {
  return unwrap(await db.rpc("get_or_create_dm", { p_other: otherUserId }));
}

/** Type, brief and members of a conversation (participants only). */
export async function getConversation(db: DB, conversationId: string): Promise<ConversationInfo> {
  const info = as<ConversationInfo | null>(unwrap(await db.rpc("get_conversation", { p_conversation: conversationId })));
  if (!info) throw new Error("Conversation not found");
  return info;
}

const MESSAGE_COLS = "id, conversation_id, sender_id, body, kind, payload, created_at";

/** Newest-first page of messages older than `before`. */
export async function getMessages(db: DB, conversationId: string, before?: string, size = 40): Promise<{ items: Message[]; hasMore: boolean }> {
  let q = db.from("messages").select(MESSAGE_COLS)
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(size);
  if (before) q = q.lt("created_at", before);
  const rows = unwrap(await q);
  return { items: rows.reverse() as Message[], hasMore: rows.length === size };
}

export async function sendMessage(db: DB, conversationId: string, body: string): Promise<Message> {
  const senderId = await requireUserId(db);
  return unwrap(await db.from("messages").insert({ conversation_id: conversationId, sender_id: senderId, body })
    .select(MESSAGE_COLS).single()) as Message;
}

export async function markConversationRead(db: DB, conversationId: string) {
  unwrap(await db.rpc("mark_conversation_read", { p_conversation: conversationId }));
}

// ---------------------------------------------------------------------------
// Hiring negotiation (campaign conversations). Every step is an RPC: the server checks who may act and when.
// ---------------------------------------------------------------------------
/** Brand: opens (or creates) the conversation with a creator about one brief. Nothing is hired yet. */
export async function startNegotiation(db: DB, campaignId: string, creatorId: string): Promise<string> {
  return unwrap(await db.rpc("start_negotiation", { p_campaign: campaignId, p_creator: creatorId }));
}

/** The pinned card: brief summary, the creator's proposed price and where the terms stand. Null for other chats. */
export async function getNegotiation(db: DB, conversationId: string): Promise<Negotiation | null> {
  return as<Negotiation | null>(unwrap(await db.rpc("get_negotiation", { p_conversation: conversationId })));
}

export async function sendOffer(db: DB, conversationId: string, price: number, terms: OfferTerms) {
  return unwrap(await db.rpc("send_offer", { p_conversation: conversationId, p_price: price, p_terms: terms as unknown as Json }));
}

export async function acceptOffer(db: DB, messageId: string) {
  unwrap(await db.rpc("accept_offer", { p_message: messageId }));
}

/** Creator: the final proposal, built server-side from the agreed offer. */
export async function sendFinalProposal(db: DB, conversationId: string, note: string | null) {
  return unwrap(await db.rpc("send_final_proposal", { p_conversation: conversationId, p_note: note }));
}

/** Brand: "Accept & hire", the only way to hire. Price and terms come from the proposal. Returns the project id. */
export async function acceptProposalAndHire(db: DB, proposalId: string): Promise<string> {
  return unwrap(await db.rpc("hire_creator", { p_proposal: proposalId }));
}

export async function rejectProposal(db: DB, proposalId: string, reason: string | null) {
  unwrap(await db.rpc("reject_proposal", { p_proposal: proposalId, p_reason: reason }));
}
