"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionProfile } from "@/types/app";
import { getBrowserClient } from "@/lib/supabase/client";

const SessionContext = createContext<SessionProfile | null>(null);

export function SessionProvider({ profile, children }: { profile: SessionProfile | null; children: ReactNode }) {
  return <SessionContext.Provider value={profile}>{children}</SessionContext.Provider>;
}

/** Signed-in user's profile (server-verified in the layout). */
export function useMe(): SessionProfile {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useMe must be used inside a signed-in layout");
  return me;
}

export function useMaybeMe(): SessionProfile | null {
  return useContext(SessionContext);
}

/** Browser Supabase client (publishable key + user session; RLS applies). */
export function useDb() {
  return getBrowserClient();
}
