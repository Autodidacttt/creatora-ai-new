import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { publicEnv } from "@/lib/env";

let admin: SupabaseClient<Database> | undefined;

/**
 * Service-role client. Bypasses RLS — only use inside route handlers / server actions
 * AFTER verifying the caller's identity and role.
 */
export function getAdminClient(): SupabaseClient<Database> {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not set");
  if (!admin) {
    admin = createClient<Database>(publicEnv.supabaseUrl, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
