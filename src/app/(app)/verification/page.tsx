"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Clock, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Verification } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { useProfile } from "@/hooks/use-profile";
import { getMyVerifications, requestVerification, withdrawVerification } from "@/services/verification";
import { getCreatorPosts } from "@/services/posts";
import { verificationRequestSchema } from "@/lib/validation/schemas";
import { VERIFICATION_TYPES } from "@/config/constants";
import { GlassPanel } from "@/components/ui/glass";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ToggleChip, Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { errorMessage, timeAgo } from "@/lib/utils";

const STATUS = {
  approved: { icon: BadgeCheck, tone: "amber" as const, label: "Approved" },
  pending: { icon: Clock, tone: "outline" as const, label: "In review" },
  rejected: { icon: XCircle, tone: "danger" as const, label: "Not approved" },
};

export default function VerificationPage() {
  const me = useMe();
  const db = useDb();
  const qc = useQueryClient();
  const profile = useProfile(me.username);
  const list = useQuery({ queryKey: ["verifications", "mine"], queryFn: () => getMyVerifications(db), enabled: me.role === "creator" });
  const posts = useQuery({ queryKey: ["creator-posts", me.id, "all"], queryFn: () => getCreatorPosts(db, me.id, 0, 60), enabled: me.role === "creator" });
  const [type, setType] = useState<Verification["type"]>("tool");
  const [v, setV] = useState({ tool_id: "", post_id: "", experience_id: "", title: "", evidence_url: "", evidence_notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  if (me.role !== "creator") {
    return <EmptyState icon={<ShieldCheck />} title="Verification is for creators" description="Brands are verified by the Creatora team during onboarding." />;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = verificationRequestSchema.safeParse({
      type,
      tool_id: v.tool_id ? Number(v.tool_id) : null,
      post_id: v.post_id || null,
      experience_id: v.experience_id || null,
      title: v.title || defaultTitle(),
      evidence_url: v.evidence_url,
      evidence_notes: v.evidence_notes,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await requestVerification(db, parsed.data);
      toast.success("Request sent — the trust team will review it");
      setV({ tool_id: "", post_id: "", experience_id: "", title: "", evidence_url: "", evidence_notes: "" });
      qc.invalidateQueries({ queryKey: ["verifications"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function defaultTitle() {
    const p = profile.data;
    if (type === "tool") return `${p?.tools.find((t) => String(t.id) === v.tool_id)?.name ?? "Tool"} — verified usage`;
    if (type === "workflow") return `Documented workflow: ${posts.data?.items.find((x) => x.id === v.post_id)?.title ?? "portfolio piece"}`;
    if (type === "past_work") {
      const x = p?.experiences.find((e) => e.id === v.experience_id);
      return x ? `${x.brand_name} — ${x.project_title}` : "Past brand collaboration";
    }
    return "Identity verification";
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="eyebrow">Trust</p>
        <h1 className="display text-3xl">Verification</h1>
        <p className="mt-1 text-sm text-ink-2">Verified signals appear on your profile and boost your relevance in brief matching. Each one shows brands exactly what was checked.</p>
      </div>

      <GlassPanel className="p-5 sm:p-7">
        <h2 className="display mb-4 text-lg">Request a verification</h2>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(VERIFICATION_TYPES) as Verification["type"][]).map((t) => (
              <ToggleChip key={t} selected={type === t} onClick={() => setType(t)}>{VERIFICATION_TYPES[t].label}</ToggleChip>
            ))}
          </div>
          <p className="rounded-2xl bg-amber-soft/60 px-4 py-3 text-sm">{VERIFICATION_TYPES[type].how}.</p>
          {type === "tool" && (
            <Field label="Tool" htmlFor="tool" error={errors.tool_id} hint="Only tools listed on your profile can be verified">
              <Select id="tool" value={v.tool_id} onChange={(e) => setV({ ...v, tool_id: e.target.value })}>
                <option value="">Choose a tool…</option>
                {profile.data?.tools.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          )}
          {type === "workflow" && (
            <Field label="Portfolio piece" htmlFor="post" error={errors.post_id}>
              <Select id="post" value={v.post_id} onChange={(e) => setV({ ...v, post_id: e.target.value })}>
                <option value="">Choose a piece…</option>
                {posts.data?.items.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
            </Field>
          )}
          {type === "past_work" && (
            <Field label="Past project" htmlFor="exp" error={errors.experience_id} hint={<>Add projects under <Link href="/settings/profile" className="underline">Edit profile → Past work</Link></>}>
              <Select id="exp" value={v.experience_id} onChange={(e) => setV({ ...v, experience_id: e.target.value })}>
                <option value="">Choose a project…</option>
                {profile.data?.experiences.map((x) => <option key={x.id} value={x.id}>{x.brand_name} — {x.project_title}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Evidence link" htmlFor="url" error={errors.evidence_url} optional hint="Project files, account gallery, breakdown video, or a brand contact page">
            <Input id="url" type="url" placeholder="https://" value={v.evidence_url} onChange={(e) => setV({ ...v, evidence_url: e.target.value })} />
          </Field>
          <Field label="Notes for the reviewer" htmlFor="notes" optional>
            <Textarea id="notes" value={v.evidence_notes} onChange={(e) => setV({ ...v, evidence_notes: e.target.value })} />
          </Field>
          <div className="flex justify-end"><Button type="submit" variant="primary" loading={saving}>Submit for review</Button></div>
        </form>
      </GlassPanel>

      <section className="space-y-3">
        <h2 className="display text-lg">Your requests</h2>
        {list.isPending && <Skeleton className="h-24" />}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
        {list.data?.length === 0 && <p className="text-sm text-ink-2">No requests yet.</p>}
        <ul className="space-y-2">
          {list.data?.map((x) => {
            const S = STATUS[x.status];
            return (
              <li key={x.id} className="glass flex items-center gap-3 rounded-[1.5rem] p-4">
                <S.icon className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{x.title}</p>
                  <p className="text-xs text-ink-3">{VERIFICATION_TYPES[x.type].label} · requested {timeAgo(x.created_at)}</p>
                </div>
                <Chip tone={S.tone}>{S.label}</Chip>
                {x.status === "pending" && (
                  <Button size="icon-sm" variant="ghost" aria-label="Withdraw request" onClick={async () => {
                    try { await withdrawVerification(db, x.id); qc.invalidateQueries({ queryKey: ["verifications"] }); toast.success("Request withdrawn"); }
                    catch (e) { toast.error(errorMessage(e)); }
                  }}><Trash2 /></Button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
