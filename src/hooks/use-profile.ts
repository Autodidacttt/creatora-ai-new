"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/features/session";
import { getProfile } from "@/services/profiles";

export function useProfile(username: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: ["profile", username],
    queryFn: () => getProfile(db, username!),
    enabled: !!username,
  });
}

/** Invalidate everything derived from profiles after an edit. */
export function useInvalidateProfile() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["search"] });
  };
}
