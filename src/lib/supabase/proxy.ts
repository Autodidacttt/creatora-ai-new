import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/", "/login", "/signup", "/auth", "/verify", "/verify-company"];
const isPublic = (path: string) =>
  PUBLIC_PATHS.some((p) => path === p || (p !== "/" && path.startsWith(`${p}/`))) ||
  path.startsWith("/api/"); // route handlers do their own auth and return JSON errors

/** Refreshes the auth session cookie and does optimistic auth redirects. */
export async function updateSession(request: NextRequest) {
  // Supabase sends users to the Site URL root (or any allow-listed page) when a redirect target isn't
  // allow-listed. Route those auth results to the callback instead of silently showing the page.
  const sp = request.nextUrl.searchParams;
  if (!request.nextUrl.pathname.startsWith("/auth/") && !request.nextUrl.pathname.startsWith("/api/") &&
      (sp.has("code") || sp.has("token_hash") || sp.has("error_code"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;

  if (!signedIn && !isPublic(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if (signedIn && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
