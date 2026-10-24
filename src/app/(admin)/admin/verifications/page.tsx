"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Building2, ChevronLeft, ChevronRight, ExternalLink, IdCard, Search, ShieldCheck, X } from "lucide-react";
import { useDb } from "@/features/session";
import { listVerifications } from "@/services/admin";
import { listCompanyVerifications, listIdentityVerifications } from "@/services/verification";
import { VERIFICATION_TYPES } from "@/config/constants";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { StatusChip } from "@/components/admin/verification-status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { SegmentedTabs } from "@/components/ui/tabs";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { timeAgo } from "@/lib/utils";

type Tab = "creators" | "recruiters" | "companies" | "past_work";
const SIZE = 20;

export default function AdminVerifications() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab) || "creators";
  const status = params.get("status") ?? "pending";
  const page = Number(params.get("page") ?? 0) || 0;
  const [query, setQuery] = useState(params.get("q") ?? "");
  const set = (patch: Record<string, string | number | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, String(v));
    }
    if (!("page" in patch)) p.delete("page");
    router.replace(`/admin/verifications?${p}`);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-3xl">Verifications</h1>
        <p className="text-sm text-ink-2">Phone and ID details stay on the server; opening an ID image or a phone number is audit-logged. Your decision is final — automated checks are advisory.</p>
      </div>
      <SegmentedTabs value={tab} onChange={(t) => set({ tab: t, status: t === "past_work" ? "pending" : status, q: null })} items={[
        { value: "creators", label: "Creators" }, { value: "recruiters", label: "Recruiters" },
        { value: "companies", label: "Companies" }, { value: "past_work", label: "Past work" },
      ]} />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedTabs size="sm" value={status} onChange={(s) => set({ status: s })} items={
          tab === "past_work"
            ? [{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]
            : [{ value: "pending", label: "Pending" }, { value: "verified", label: "Verified" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" }]} />
        {tab !== "past_work" && (
          <form className="ml-auto flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); set({ q: query }); }}>
            <Input aria-label="Search" placeholder={tab === "companies" ? "Company or domain" : "Name or username"} value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 w-56" />
            <Button size="sm" type="submit"><Search /> Search</Button>
          </form>
        )}
      </div>
      {tab === "past_work" ? <PastWorkQueue status={status as "pending" | "approved" | "rejected"} />
        : tab === "companies" ? <CompanyQueue status={status} query={params.get("q") ?? ""} page={page} onPage={(n) => set({ page: n })} />
        : <IdentityQueue kind={tab === "creators" ? "creator" : "recruiter"} status={status} query={params.get("q") ?? ""} page={page} onPage={(n) => set({ page: n })} />}
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (n: number) => void }) {
  const pages = Math.max(Math.ceil(total / SIZE), 1);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-end gap-2 text-sm">
      <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft /> Previous</Button>
      <span className="tabular-nums text-ink-3">{page + 1} / {pages}</span>
      <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight /></Button>
    </nav>
  );
}

function IdentityQueue({ kind, status, query, page, onPage }: { kind: "creator" | "recruiter"; status: string; query: string; page: number; onPage: (n: number) => void }) {
  const db = useDb();
  const q = useQuery({ queryKey: ["admin", "identity", kind, status, query, page], queryFn: () => listIdentityVerifications(db, kind, status === "all" ? null : status, query, page, SIZE) });
  if (q.isPending) return <>{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.items.length) return <EmptyState icon={<IdCard />} title={status === "pending" ? "Queue is clear" : "Nothing here"} />;
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {q.data.items.map((v) => (
          <li key={v.id}>
            <Link href={`/admin/verifications/identity/${v.id}`} className="glass flex flex-wrap items-center gap-3 rounded-[1.5rem] p-4 hover:shadow-lift">
              <Avatar src={v.user.avatar_url} name={v.user.display_name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{v.full_name} <span className="font-normal text-ink-3">· @{v.user.username}</span></span>
                <span className="block text-xs text-ink-3">ID ••••{v.id_last4} · submitted {timeAgo(v.created_at)}{v.mock_result ? ` · simulated check: ${v.mock_result}` : ""}</span>
              </span>
              <StatusChip status={v.status} />
            </Link>
          </li>
        ))}
      </ul>
      <Pager page={page} total={q.data.total} onPage={onPage} />
    </div>
  );
}

function CompanyQueue({ status, query, page, onPage }: { status: string; query: string; page: number; onPage: (n: number) => void }) {
  const db = useDb();
  const q = useQuery({ queryKey: ["admin", "company", status, query, page], queryFn: () => listCompanyVerifications(db, status === "all" ? null : status, query, page, SIZE) });
  if (q.isPending) return <>{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.items.length) return <EmptyState icon={<Building2 />} title={status === "pending" ? "Queue is clear" : "Nothing here"} />;
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {q.data.items.map((c) => (
          <li key={c.id}>
            <Link href={`/admin/verifications/company/${c.id}`} className="glass flex flex-wrap items-center gap-3 rounded-[1.5rem] p-4 hover:shadow-lift">
              <span className="grid size-10 place-items-center rounded-full bg-card"><Building2 className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{c.company_name} <span className="font-normal text-ink-3">· {c.website_domain}</span></span>
                <span className="block text-xs text-ink-3">
                  {c.applicant_name} ({c.applicant_role}) · {c.domain_match ? "email domain matches" : c.free_mail ? "free-mail address" : "email domain differs"}
                  {c.invitation ? ` · invitation ${c.invitation.status}` : ""} · {timeAgo(c.created_at)}
                </span>
              </span>
              <StatusChip status={c.status} impersonation={c.rejection_source === "company_contact"} />
            </Link>
          </li>
        ))}
      </ul>
      <Pager page={page} total={q.data.total} onPage={onPage} />
    </div>
  );
}

/** Past brand work (evidence-based; unchanged review flow) */
function PastWorkQueue({ status }: { status: "pending" | "approved" | "rejected" }) {
  const db = useDb();
  const q = useQuery({ queryKey: ["admin", "verifications", status], queryFn: () => listVerifications(db, status) });
  const { busy, run } = useAdminAction();
  if (q.isPending) return <>{[0, 1].map((i) => <Skeleton key={i} className="h-32" />)}</>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState icon={<ShieldCheck />} title={status === "pending" ? "Queue is clear" : `No ${status} requests`} />;
  return (
    <ul className="space-y-3">
      {q.data.map((v) => (
        <li key={v.id} className="glass rounded-[1.75rem] p-5">
          <div className="flex flex-wrap items-start gap-3">
            <Link href={`/u/${v.creator.username}`} className="flex items-center gap-3">
              <Avatar src={v.creator.avatar_url} name={v.creator.display_name} verified={v.creator.is_verified} />
              <span className="text-sm font-semibold">{v.creator.display_name}</span>
            </Link>
            <Chip tone="amber">{VERIFICATION_TYPES[v.type as keyof typeof VERIFICATION_TYPES]?.label ?? v.type}</Chip>
            <span className="ml-auto text-xs text-ink-3">requested {timeAgo(v.created_at)}</span>
          </div>
          <p className="mt-3 font-semibold">{v.title}</p>
          <p className="text-sm text-ink-2">Subject: {v.subject}</p>
          {v.evidence_notes && <p className="mt-2 rounded-2xl bg-card p-3 text-sm">{v.evidence_notes}</p>}
          {v.evidence_url && (
            <a href={v.evidence_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm underline">Evidence <ExternalLink className="size-3.5" /></a>
          )}
          {status === "pending" && (
            <div className="mt-4 flex gap-2">
              <Button size="sm" variant="primary" loading={busy === `a-${v.id}`} onClick={() => run(`a-${v.id}`, { action: "review_verification", verification_id: v.id, status: "approved" }, "Approved")}><BadgeCheck /> Approve</Button>
              <Button size="sm" variant="danger" loading={busy === `r-${v.id}`} onClick={() => run(`r-${v.id}`, { action: "review_verification", verification_id: v.id, status: "rejected" }, "Rejected")}><X /> Reject</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
