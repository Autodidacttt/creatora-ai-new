import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getServerClient } from "@/lib/supabase/server";
import { classifyAuthError, safeNext } from "@/lib/auth-links";

const OTP_TYPES: EmailOtpType[] = ["signup", "email", "invite", "magiclink", "recovery", "email_change"];

/**
 * Landing route for every Supabase email link. Handles:
 *  - PKCE links            ?code=…                 (default template, same browser as signup)
 *  - token-hash links      ?token_hash=…&type=…    (recommended template, works on any device)
 *  - error redirects       ?error=…&error_code=…   (expired / used / invalid links)
 *  - implicit-flow links   #access_token=…         (fragment; forwarded to /auth/finish in the browser)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const next = safeNext(params.get("next"));
  const toLogin = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));

  const errorCode = params.get("error_code") ?? params.get("error");
  if (errorCode) return toLogin(classifyAuthError(params.get("error_code"), params.get("error_description")));

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  if (code || tokenHash) {
    const db = await getServerClient();
    const { error } = code
      ? await db.auth.exchangeCodeForSession(code)
      : type && OTP_TYPES.includes(type)
        ? await db.auth.verifyOtp({ token_hash: tokenHash!, type })
        : { error: { code: "invalid", message: "Missing or unknown link type" } };

    if (!error) return NextResponse.redirect(new URL(next, url.origin));

    // A link opened twice by an already signed-in user is not an error worth showing.
    const { data } = await db.auth.getClaims();
    if (data?.claims?.sub) return NextResponse.redirect(new URL(next, url.origin));

    console.warn("[auth/callback] link verification failed:", error.code ?? "", error.message);
    return toLogin(classifyAuthError(error.code, error.message));
  }

  // No query params: tokens may be in the URL fragment, which only the browser can read.
  return NextResponse.redirect(new URL(`/auth/finish?next=${encodeURIComponent(next)}`, url.origin));
}
