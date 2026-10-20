"use client";

import { useEffect } from "react";

/**
 * Implicit-flow auth links put their result in the URL fragment (#access_token=… / #error_code=…),
 * which servers never receive. If one lands on any page other than /auth/finish (e.g. the Site URL
 * root), hand it over so the session is created or a clear error is shown.
 */
export function AuthFragmentForwarder() {
  useEffect(() => {
    const { hash, pathname, search } = window.location;
    if (pathname === "/auth/finish") return;
    if (/[#&](access_token|error_code|error)=/.test(hash)) {
      window.location.replace(`/auth/finish${search}${hash}`);
    }
  }, []);
  return null;
}
