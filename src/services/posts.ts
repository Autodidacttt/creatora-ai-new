import type { MiniProfile, PostCard } from "@/types/app";
import type { PostInput } from "@/lib/validation/schemas";
import { as, type DB, requireUserId, unwrap } from "./_db";

export interface Page<T> {
  items: T[];
  total: number;
  nextPage: number | null;
}

export function toPage<T>(items: T[], total: number, page: number, size: number): Page<T> {
  return { items, total, nextPage: (page + 1) * size < total ? page + 1 : null };
}

export async function getPost(db: DB, id: string): Promise<PostCard | null> {
  return as<PostCard | null>(unwrap(await db.rpc("get_post", { p_id: id })));
}

export async function getCreatorPosts(db: DB, creatorId: string, page = 0, size = 24): Promise<Page<PostCard>> {
  const rows = unwrap(await db.rpc("get_creator_posts", { p_creator: creatorId, p_limit: size, p_offset: page * size }));
  return toPage(rows.map((r) => as<PostCard>(r.post)), rows[0]?.total_count ?? 0, page, size);
}

export async function getSavedPosts(db: DB, page = 0, size = 24): Promise<Page<PostCard>> {
  const rows = unwrap(await db.rpc("get_saved_posts", { p_limit: size, p_offset: page * size }));
  return toPage(rows.map((r) => as<PostCard>(r.post)), rows[0]?.total_count ?? 0, page, size);
}

export interface FeedItem {
  post: PostCard;
  reason: "following" | "for_you" | "fresh" | "explore";
}

export async function getFeed(db: DB, page = 0, size = 12): Promise<{ items: FeedItem[]; nextPage: number | null }> {
  const rows = unwrap(await db.rpc("get_feed", { p_limit: size, p_offset: page * size }));
  return {
    items: rows.map((r) => ({ post: as<PostCard>(r.post), reason: r.reason as FeedItem["reason"] })),
    nextPage: rows.length === size ? page + 1 : null,
  };
}

type PostValues = Omit<PostInput, "tool_ids">;

function postRow(values: PostValues) {
  return {
    title: values.title,
    description: values.description ?? null,
    media_type: values.media_type,
    media_url: values.media_url ?? null,
    thumbnail_url: values.thumbnail_url ?? null,
    source_link: values.source_link ?? null,
    embed_provider: values.embed_provider ?? null,
    content_type_id: values.content_type_id,
    style_id: values.style_id,
    category_id: values.category_id,
    aspect_ratio: values.aspect_ratio,
    commercial_use_cleared: values.commercial_use_cleared,
    workflow_notes: values.workflow_notes ?? null,
    workflow_steps: values.workflow_steps,
  };
}

export async function createPost(db: DB, values: PostValues, toolIds: number[]): Promise<string> {
  const creatorId = await requireUserId(db);
  const post = unwrap(await db.from("posts").insert({ ...postRow(values), creator_id: creatorId }).select("id").single());
  if (toolIds.length) {
    unwrap(await db.from("post_tools").insert(toolIds.map((tool_id) => ({ post_id: post.id, tool_id }))));
  }
  return post.id;
}

export async function updatePost(db: DB, id: string, values: PostValues, toolIds: number[]) {
  unwrap(await db.from("posts").update(postRow(values)).eq("id", id));
  unwrap(await db.from("post_tools").delete().eq("post_id", id));
  if (toolIds.length) {
    unwrap(await db.from("post_tools").insert(toolIds.map((tool_id) => ({ post_id: id, tool_id }))));
  }
}

export async function deletePost(db: DB, id: string) {
  unwrap(await db.from("posts").delete().eq("id", id));
}

export interface Comment {
  id: string;
  body: string;
  created_at: string;
  author: MiniProfile;
}

export async function getComments(db: DB, postId: string): Promise<Comment[]> {
  const rows = unwrap(await db.rpc("get_comments", { p_post: postId, p_limit: 100 }));
  return rows.map((r) => ({ id: r.id, body: r.body, created_at: r.created_at, author: as<MiniProfile>(r.author) }));
}

export async function addComment(db: DB, postId: string, body: string) {
  const userId = await requireUserId(db);
  unwrap(await db.from("comments").insert({ post_id: postId, user_id: userId, body }));
}

export async function deleteComment(db: DB, id: string) {
  unwrap(await db.from("comments").delete().eq("id", id));
}

/** Detects embeddable providers from a pasted link. */
export function detectEmbed(url: string): { provider: PostCard["embed_provider"]; embedUrl: string | null; thumbnail: string | null } {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtube.com" || host === "youtu.be") {
      const id = host === "youtu.be" ? u.pathname.slice(1) : u.searchParams.get("v") ?? u.pathname.split("/").filter(Boolean).pop();
      if (id) return { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
    }
    if (host === "vimeo.com" || host === "player.vimeo.com") {
      const id = u.pathname.split("/").filter((p) => /^\d+$/.test(p)).pop();
      if (id) return { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}`, thumbnail: null };
    }
    if (host === "instagram.com") {
      const m = u.pathname.match(/\/(p|reel)\/([^/]+)/);
      if (m) return { provider: "instagram", embedUrl: `https://www.instagram.com/${m[1]}/${m[2]}/embed`, thumbnail: null };
    }
    if (host === "tiktok.com") {
      const m = u.pathname.match(/video\/(\d+)/);
      if (m) return { provider: "tiktok", embedUrl: `https://www.tiktok.com/embed/v2/${m[1]}`, thumbnail: null };
    }
    if (host === "behance.net") return { provider: "behance", embedUrl: null, thumbnail: null };
    return { provider: "other", embedUrl: null, thumbnail: null };
  } catch {
    return { provider: null, embedUrl: null, thumbnail: null };
  }
}
