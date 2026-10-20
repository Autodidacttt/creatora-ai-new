import "server-only";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { Role, SessionProfile } from "@/types/app";
import { getServerClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/services/profiles";

/** Verified (JWT-checked) session + profile, or null. */
export async function getSession(): Promise<{ profile: SessionProfile } | null> {
  const db = await getServerClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return null;
  const profile = await getSessionProfile(db, userId);
  return profile ? { profile } : null;
}

/** For server layouts/pages: redirects when signed out, not onboarded, or wrong role. */
export async function requireSession(opts: { roles?: Role[]; allowNotOnboarded?: boolean } = {}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { profile } = session;
  if (!opts.allowNotOnboarded && !profile.onboarded && profile.role !== "admin") redirect("/onboarding");
  if (opts.roles && !opts.roles.includes(profile.role)) redirect(profile.role === "admin" ? "/admin" : "/home");
  return session;
}

/** For route handlers: returns the session or a JSON error response. */
export async function apiSession(roles?: Role[]) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Please sign in." }, { status: 401 }) } as const;
  }
  if (session.profile.is_suspended) {
    return { error: NextResponse.json({ error: "Your account is suspended." }, { status: 403 }) } as const;
  }
  if (roles && !roles.includes(session.profile.role)) {
    return { error: NextResponse.json({ error: "You don't have access to this action." }, { status: 403 }) } as const;
  }
  return { session } as const;
}
