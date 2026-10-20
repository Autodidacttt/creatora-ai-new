"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { classifyAuthError, safeNext } from "@/lib/auth-links";

/**
 * Finishes auth links that carry their result in the URL fragment (#access_token=… or #error=…).
 * The server never sees fragments, so this has to run in the browser.
 */
export default function AuthFinishPage() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const next = safeNext(query.get("next"));
    const go = (path: string) => window.location.replace(path);

    const errorCode = hash.get("error_code") ?? hash.get("error") ?? query.get("error_code") ?? query.get("error");
    if (errorCode) {
      go(`/login?error=${classifyAuthError(hash.get("error_code") ?? query.get("error_code"), hash.get("error_description") ?? query.get("error_description"))}`);
      return;
    }
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (!access_token || !refresh_token) {
      go("/login?error=invalid");
      return;
    }
    getBrowserClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => go(error ? `/login?error=${classifyAuthError(error.code, error.message)}` : next));
  }, []);

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="glass flex items-center gap-3 rounded-full px-6 py-4 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Confirming your account…
      </div>
    </div>
  );
}
