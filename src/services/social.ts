import { type DB, requireUserId, unwrap } from "./_db";

type Target = "profile" | "post" | "campaign";
export type InteractionAction =
  | "view" | "like" | "save" | "follow" | "swipe_left" | "swipe_right" | "contact" | "ignore" | "apply" | "shortlist"
  | "skip" | "navigate" | "watch" | "comment";
type Action = InteractionAction;

const WEIGHTS: Record<Action, number> = {
  view: 0.2, like: 1, save: 2, follow: 3, swipe_left: -1, swipe_right: 2, contact: 3, ignore: -2, apply: 3, shortlist: 3,
  skip: -0.5, navigate: 0, watch: 0.5, comment: 2,
};

/** Behavioural signal used by the swipe deck and feed scoring. */
export async function recordInteraction(db: DB, targetType: Target, targetId: string, action: Action, context: Record<string, unknown> = {}) {
  const userId = await requireUserId(db);
  unwrap(await db.from("interactions").insert({
    user_id: userId, target_type: targetType, target_id: targetId, action, weight: WEIGHTS[action], context: context as never,
  }));
}

export async function setLike(db: DB, postId: string, liked: boolean) {
  const userId = await requireUserId(db);
  if (liked) {
    unwrap(await db.from("likes").upsert({ user_id: userId, post_id: postId }, { onConflict: "user_id,post_id", ignoreDuplicates: true }));
  } else {
    unwrap(await db.from("likes").delete().eq("user_id", userId).eq("post_id", postId));
  }
}

export async function setSave(db: DB, postId: string, saved: boolean) {
  const userId = await requireUserId(db);
  if (saved) {
    unwrap(await db.from("saves").upsert({ user_id: userId, post_id: postId }, { onConflict: "user_id,post_id", ignoreDuplicates: true }));
  } else {
    unwrap(await db.from("saves").delete().eq("user_id", userId).eq("post_id", postId));
  }
}

export async function setFollow(db: DB, profileId: string, following: boolean) {
  const userId = await requireUserId(db);
  if (following) {
    unwrap(await db.from("follows").upsert(
      { follower_id: userId, following_id: profileId },
      { onConflict: "follower_id,following_id", ignoreDuplicates: true },
    ));
    await recordInteraction(db, "profile", profileId, "follow").catch(() => undefined);
  } else {
    unwrap(await db.from("follows").delete().eq("follower_id", userId).eq("following_id", profileId));
  }
}

export async function report(
  db: DB,
  values: { target_type: "profile" | "post" | "comment" | "campaign" | "message"; target_id: string; reason: string; details?: string | null },
) {
  const userId = await requireUserId(db);
  unwrap(await db.from("reports").insert({ ...values, reporter_id: userId }));
}
