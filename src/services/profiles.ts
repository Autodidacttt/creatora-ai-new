import type { FullProfile, MiniProfile, SessionProfile } from "@/types/app";
import type { CreatorAttributes } from "@/lib/validation/schemas";
import { as, type DB, requireUserId, ServiceError, unwrap, unwrapMaybe } from "./_db";

export async function getSessionProfile(db: DB, userId: string): Promise<SessionProfile | null> {
  const res = await db
    .from("profiles")
    .select("id, role, username, display_name, avatar_url, onboarded, is_suspended, is_verified")
    .eq("id", userId)
    .maybeSingle();
  return as<SessionProfile | null>(unwrapMaybe(res));
}

export async function getProfile(db: DB, username: string): Promise<FullProfile | null> {
  const data = unwrap(await db.rpc("get_profile", { p_username: username }));
  return as<FullProfile | null>(data);
}

export async function updateProfile(
  db: DB,
  values: {
    display_name?: string;
    username?: string;
    headline?: string | null;
    bio?: string | null;
    location?: string | null;
    website?: string | null;
    links?: Record<string, string>;
    avatar_url?: string | null;
    cover_url?: string | null;
    onboarded?: boolean;
  },
) {
  const id = await requireUserId(db);
  const res = await db.from("profiles").update(values).eq("id", id).select("id").single();
  if (res.error?.code === "23505") throw new ServiceError("That username is taken.");
  unwrap(res);
}

export async function updateCreatorDetails(
  db: DB,
  values: {
    experience_level: string;
    availability: string;
    years_experience?: number | null;
    rate_min?: number | null;
    rate_max?: number | null;
    currency: string;
    workflow_overview?: string | null;
  },
) {
  const id = await requireUserId(db);
  unwrap(await db.from("creator_details").update(values).eq("profile_id", id));
}

export async function updateBrandDetails(
  db: DB,
  values: { company_name: string; industry?: string | null; company_size?: string | null; description?: string | null },
) {
  const id = await requireUserId(db);
  unwrap(await db.from("brand_details").update(values).eq("profile_id", id));
}

/** Replaces the creator's tools / skills / categories / etc. with the given selection. */
export async function setCreatorAttributes(db: DB, attrs: CreatorAttributes) {
  const id = await requireUserId(db);
  const jobs: [string, string, Record<string, unknown>[]][] = [
    ["creator_tools", "tool_id", attrs.tools.map((t) => ({ creator_id: id, tool_id: t.id, proficiency: t.proficiency }))],
    ["creator_skills", "skill_id", attrs.skills.map((v) => ({ creator_id: id, skill_id: v }))],
    ["creator_categories", "category_id", attrs.categories.map((v) => ({ creator_id: id, category_id: v }))],
    ["creator_content_types", "content_type_id", attrs.content_types.map((v) => ({ creator_id: id, content_type_id: v }))],
    ["creator_styles", "style_id", attrs.styles.map((v) => ({ creator_id: id, style_id: v }))],
    ["creator_languages", "language_id", attrs.languages.map((v) => ({ creator_id: id, language_id: v }))],
    ["creator_platforms", "platform_id", attrs.platforms.map((v) => ({ creator_id: id, platform_id: v }))],
  ];
  for (const [table, col, rows] of jobs) {
    const keep = rows.map((r) => r[col] as number);
    // remove deselected rows, then upsert the selection
    const del = db.from(table as "creator_skills").delete().eq("creator_id", id);
    unwrap(await (keep.length ? del.not(col as "skill_id", "in", `(${keep.join(",")})`) : del));
    if (rows.length) {
      unwrap(await db.from(table as "creator_skills").upsert(rows as never, { onConflict: `creator_id,${col}` }));
    }
  }
}

export async function addExperience(
  db: DB,
  values: { brand_name: string; project_title: string; year?: number | null; description?: string | null; link?: string | null },
) {
  const id = await requireUserId(db);
  unwrap(await db.from("creator_experiences").insert({ ...values, creator_id: id }));
}

export async function deleteExperience(db: DB, experienceId: string) {
  unwrap(await db.from("creator_experiences").delete().eq("id", experienceId));
}

export async function uploadToBucket(db: DB, bucket: "avatars" | "post-media" | "campaign-assets", file: File) {
  const id = await requireUserId(db);
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new ServiceError(error.message);
  return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export async function getFollowList(db: DB, userId: string, kind: "followers" | "following", page = 0, size = 30) {
  const rows = unwrap(await db.rpc("get_follow_list", { p_user: userId, p_kind: kind, p_limit: size, p_offset: page * size }));
  return {
    items: rows.map((r) => ({ profile: as<MiniProfile>(r.profile), is_following: r.is_following })),
    total: rows[0]?.total_count ?? 0,
  };
}
