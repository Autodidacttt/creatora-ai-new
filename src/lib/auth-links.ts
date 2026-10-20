// Shared by the auth callback route, the fragment-finishing page and the sign-in page.

/** Only allow same-site relative paths as post-auth destinations (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/home"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

/** Why a confirmation link didn't produce a session. Shown as a friendly message on /login. */
export type AuthLinkError = "expired" | "other_browser" | "invalid";

/** Maps Supabase error codes / messages (query, fragment or SDK errors) to a reason. */
export function classifyAuthError(code: string | null | undefined, message?: string | null): AuthLinkError {
  const c = (code ?? "").toLowerCase();
  const m = (message ?? "").toLowerCase();
  if (c === "otp_expired" || m.includes("expired") || m.includes("already been used") || m.includes("invalid or has expired")) {
    return "expired";
  }
  // PKCE: the link was opened in a different browser/device than the one that signed up.
  // Supabase has already confirmed the email by this point; only the session hand-off failed.
  if (c === "bad_code_verifier" || c === "flow_state_not_found" || c === "flow_state_expired" ||
      m.includes("code verifier") || m.includes("flow state")) {
    return "other_browser";
  }
  return "invalid";
}

export const AUTH_LINK_MESSAGES: Record<AuthLinkError, { title: string; body: string; offerResend: boolean }> = {
  expired: {
    title: "That link has expired or was already used",
    body: "If you already confirmed your email, just sign in. Otherwise enter your email below and we'll send a fresh link.",
    offerResend: true,
  },
  other_browser: {
    title: "Your email is confirmed",
    body: "The link was opened in a different browser than the one you signed up in, so we couldn't sign you in automatically. Sign in with your email and password to continue.",
    offerResend: false,
  },
  invalid: {
    title: "We couldn't verify that link",
    body: "Try signing in. If your email isn't confirmed yet, request a new confirmation link below.",
    offerResend: true,
  },
};
