"use client";

import { useQuery } from "@tanstack/react-query";
import { useDb } from "@/features/session";
import { getLookups } from "@/services/lookups";

export function useLookups() {
  const db = useDb();
  return useQuery({ queryKey: ["lookups"], queryFn: () => getLookups(db), staleTime: Infinity, gcTime: Infinity });
}
