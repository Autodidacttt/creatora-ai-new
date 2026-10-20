"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { publicEnv } from "@/lib/env";

export type DB = SupabaseClient<Database>;

let client: DB | undefined;

/** Singleton browser client (publishable key + user session cookie). */
export function getBrowserClient(): DB {
  if (!client) {
    client = createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey);
  }
  return client;
}
