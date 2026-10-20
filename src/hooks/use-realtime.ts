"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDb, useMaybeMe } from "@/features/session";
import { getUnreadCounts } from "@/services/notifications";

/** Unread badge counts, kept live via Supabase Realtime (RLS limits events to this user). */
export function useUnreadCounts() {
  const db = useDb();
  const me = useMaybeMe();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["unread"],
    queryFn: () => getUnreadCounts(db),
    enabled: !!me,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!me) return;
    const channel = db
      .channel(`badges:${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${me.id}` }, () => {
        qc.invalidateQueries({ queryKey: ["unread"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["unread"] });
        qc.invalidateQueries({ queryKey: ["inbox"] });
      })
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [db, me, qc]);

  return query.data ?? { notifications: 0, messages: 0 };
}
