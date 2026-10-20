import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** A Supabase client acting as the current user (browser or server). RLS always applies. */
export type DB = SupabaseClient<Database>;

export class ServiceError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  "23505": "That already exists.",
  "42501": "You don't have permission to do that.",
  "23514": "Some values are not allowed.",
  PGRST116: "Not found.",
};

/** Throws a readable error for failed queries; returns data otherwise. */
export function unwrap<T>(res: { data: T; error: PostgrestError | null }): NonNullable<T> {
  if (res.error) {
    const msg = res.error.code && FRIENDLY[res.error.code] && !res.error.message.includes("exception")
      ? FRIENDLY[res.error.code]
      : res.error.message;
    throw new ServiceError(msg, res.error.code);
  }
  return res.data as NonNullable<T>;
}

/** Like unwrap, but keeps null (for maybeSingle lookups). */
export function unwrapMaybe<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) unwrap(res);
  return res.data;
}

/** RPC JSON columns are typed as `Json`; this narrows them to the read-model types in `types/app`. */
export const as = <T>(value: unknown) => value as T;

export async function requireUserId(db: DB): Promise<string> {
  const { data } = await db.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new ServiceError("Please sign in first.", "401");
  return id;
}
