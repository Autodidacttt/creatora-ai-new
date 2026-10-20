"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Ban, Search, ShieldOff } from "lucide-react";
import { useDb, useMe } from "@/features/session";
import { useDebounced } from "@/hooks/use-debounce";
import { listUsers } from "@/services/admin";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { timeAgo } from "@/lib/utils";

export default function AdminUsers() {
  const db = useDb();
  const me = useMe();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | "creator" | "brand" | "admin">("all");
  const [page, setPage] = useState(0);
  const q = useDebounced(query, 300);
  const users = useQuery({ queryKey: ["admin", "users", q, role, page], queryFn: () => listUsers(db, { query: q, role: role === "all" ? null : role }, page) });
  const { busy, run } = useAdminAction();

  return (
    <div className="space-y-5">
      <h1 className="display text-3xl">Users</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-11 flex-1 items-center gap-2 rounded-full bg-card px-4 shadow-sm">
          <Search className="size-4 text-ink-3" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search name, username or email" aria-label="Search users" className="w-full bg-transparent text-sm focus:outline-none" />
        </label>
        <SegmentedTabs size="sm" value={role} onChange={(r) => { setRole(r); setPage(0); }} items={[{ value: "all", label: "All" }, { value: "creator", label: "Creators" }, { value: "brand", label: "Brands" }, { value: "admin", label: "Admins" }]} />
      </div>
      {users.isPending && [0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
      {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
      {users.data?.items.length === 0 && <EmptyState title="No users found" />}
      <ul className="space-y-2">
        {users.data?.items.map((u) => (
          <li key={u.id} className="glass flex flex-wrap items-center gap-3 rounded-[1.5rem] p-3">
            <Link href={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar src={u.avatar_url} name={u.display_name} verified={u.is_verified} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{u.display_name} <span className="font-normal text-ink-3">@{u.username}</span></span>
                <span className="block truncate text-xs text-ink-3">{u.email} · joined {timeAgo(u.created_at)} · {u.followers} followers · {u.posts} posts</span>
              </span>
            </Link>
            <Chip tone="outline" className="capitalize">{u.role}</Chip>
            {u.pending_verifications > 0 && <Link href="/admin/verifications"><Chip tone="amber">{u.pending_verifications} pending</Chip></Link>}
            {u.is_suspended && <Chip tone="danger">Suspended</Chip>}
            {u.role !== "admin" && (
              <div className="flex gap-1.5">
                <Button size="sm" variant={u.is_verified ? "secondary" : "primary"} loading={busy === `v-${u.id}`}
                  onClick={() => run(`v-${u.id}`, { action: "set_verified", user_id: u.id, value: !u.is_verified }, u.is_verified ? "Verification removed" : "Marked as verified")}>
                  {u.is_verified ? <ShieldOff /> : <BadgeCheck />} {u.is_verified ? "Unverify" : "Verify"}
                </Button>
                {u.id !== me.id && (
                  <Button size="sm" variant={u.is_suspended ? "secondary" : "danger"} loading={busy === `s-${u.id}`}
                    onClick={() => run(`s-${u.id}`, { action: "set_suspended", user_id: u.id, value: !u.is_suspended }, u.is_suspended ? "Account restored" : "Account suspended")}>
                    <Ban /> {u.is_suspended ? "Unsuspend" : "Suspend"}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {users.data && users.data.total > 30 && (
        <div className="flex justify-center gap-2">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="self-center text-sm text-ink-3">Page {page + 1} of {Math.ceil(users.data.total / 30)}</span>
          <Button size="sm" disabled={(page + 1) * 30 >= users.data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
