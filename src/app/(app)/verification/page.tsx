"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Briefcase, Building2, Clock, IdCard, Phone, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { useProfile } from "@/hooks/use-profile";
import { getMyVerification, getMyVerifications, requestPastWorkVerification, setBrandType, withdrawVerification } from "@/services/verification";
import { verificationRequestSchema } from "@/lib/validation/schemas";
import { GlassPanel } from "@/components/ui/glass";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { BrandTypePicker } from "@/components/verification/brand-type-picker";
import { PhoneVerification } from "@/components/verification/phone-verification";
import { IdentityForm } from "@/components/verification/identity-form";
import { CompanyForm } from "@/components/verification/company-form";
import { TrustBadges } from "@/components/verification/trust-badges";
import { errorMessage, timeAgo } from "@/lib/utils";

const STATUS = {
  approved: { icon: BadgeCheck, tone: "amber" as const, label: "Approved" },
  pending: { icon: Clock, tone: "outline" as const, label: "In review" },
  rejected: { icon: XCircle, tone: "danger" as const, label: "Not approved" },
};

function Step({ n, icon, title, body, children }: { n: number; icon: React.ReactNode; title: string; body: string; children: React.ReactNode }) {
  return (
    <GlassPanel className="space-y-4 p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-soft [&_svg]:size-4" aria-hidden>{icon}</span>
        <div>
          <h2 className="display text-lg"><span className="sr-only">Step {n}: </span>{title}</h2>
          <p className="text-sm text-ink-2">{body}</p>
        </div>
      </div>
      {children}
    </GlassPanel>
  );
}

export default function VerificationPage() {
  const me = useMe();
  const db = useDb();
  const qc = useQueryClient();
  const welcome = useSearchParams().get("welcome") === "1";
  const status = useQuery({ queryKey: ["verification", "me"], queryFn: getMyVerification });
  const [typeBusy, setTypeBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["verification"] }); qc.invalidateQueries({ queryKey: ["profile"] }); };

  if (me.role === "admin") return <EmptyState icon={<ShieldCheck />} title="Admins review verifications" description="Open the Verifications queue in the Admin area." action={<Link href="/admin/verifications" className="underline">Open queue</Link>} />;
  if (status.isPending) return <div className="mx-auto max-w-3xl space-y-4"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  const s = status.data;
  const isBrand = s.role === "brand";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="eyebrow">{welcome ? "Last step — or do it later" : "Trust"}</p>
        <h1 className="display text-3xl">Verification</h1>
        <p className="mt-1 text-sm text-ink-2">
          {isBrand
            ? "Verified brands can publish briefs and hire. Creators see exactly what was verified on your profile."
            : "Verified signals appear on your profile and cards. Each badge tells brands exactly what was checked."}
        </p>
        <div className="mt-2"><TrustBadges size="md" role={s.role} badges={{ phone_verified: !!s.phone, identity_verified: s.identity_verified, company_verified: s.company_verified, brand_type: s.brand_type }} /></div>
        {isBrand && !s.can_operate && (
          <p className="mt-3 rounded-2xl bg-amber-soft/70 px-4 py-3 text-sm" role="status">You can complete your profile and save drafts now. Publishing a brief and hiring unlock once your account is verified.</p>
        )}
        {welcome && <Link href="/campaigns/new?welcome=1" className="mt-2 inline-block text-sm font-semibold underline-offset-4 hover:underline">Skip for now →</Link>}
      </div>

      {isBrand && (
        <GlassPanel className="p-5 sm:p-7">
          <BrandTypePicker value={s.brand_type} disabled={typeBusy || s.identity?.status === "pending" || s.company?.status === "pending"} onChange={async (t) => {
            setTypeBusy(true);
            try { await setBrandType(db, t); refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setTypeBusy(false); }
          }} />
        </GlassPanel>
      )}

      {(!isBrand || s.brand_type) && (
        <Step n={1} icon={<Phone />} title="Phone number" body="A one-time code proves you own this number. One number can only be verified on one account.">
          <PhoneVerification status={s} onVerified={refresh} />
        </Step>
      )}
      {(!isBrand || s.brand_type === "individual") && (
        <Step n={2} icon={<IdCard />} title="Identity" body="A trust-team member reviews your government ID. Your profile shows “Identity Verified” once approved.">
          <IdentityForm status={s} onSubmitted={refresh} />
        </Step>
      )}
      {isBrand && s.brand_type === "company" && (
        <Step n={2} icon={<Building2 />} title="Company" body="We confirm with an official company contact that you may represent the company.">
          <CompanyForm status={s} onSubmitted={refresh} />
        </Step>
      )}
      {me.role === "creator" && <PastWork />}
    </div>
  );
}

/** Past brand work (the remaining evidence-based verification for creators) */
function PastWork() {
  const me = useMe();
  const db = useDb();
  const qc = useQueryClient();
  const profile = useProfile(me.username);
  const list = useQuery({ queryKey: ["verifications", "mine"], queryFn: () => getMyVerifications(db) });
  const [v, setV] = useState({ experience_id: "", evidence_url: "", evidence_notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const x = profile.data?.experiences.find((p) => p.id === v.experience_id);
    const parsed = verificationRequestSchema.safeParse({ ...v, title: x ? `${x.brand_name} — ${x.project_title}` : "Past brand collaboration" });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({}); setSaving(true);
    try {
      await requestPastWorkVerification(db, parsed.data);
      toast.success("Request sent — the trust team will review it");
      setV({ experience_id: "", evidence_url: "", evidence_notes: "" });
      qc.invalidateQueries({ queryKey: ["verifications"] });
    } catch (err) { toast.error(errorMessage(err)); } finally { setSaving(false); }
  }

  return (
    <Step n={3} icon={<Briefcase />} title="Past work" body="Confirmed with the brand or via a completed campaign.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Past project" htmlFor="exp" error={errors.experience_id} hint={<>Add projects under <Link href="/settings/profile" className="underline">Edit profile → Past work</Link></>}>
          <Select id="exp" value={v.experience_id} onChange={(e) => setV({ ...v, experience_id: e.target.value })}>
            <option value="">Choose a project…</option>
            {profile.data?.experiences.map((x) => <option key={x.id} value={x.id}>{x.brand_name} — {x.project_title}</option>)}
          </Select>
        </Field>
        <Field label="Evidence link" htmlFor="url" error={errors.evidence_url} optional hint="Project files, a breakdown video, or a brand contact page">
          <Input id="url" type="url" placeholder="https://" value={v.evidence_url} onChange={(e) => setV({ ...v, evidence_url: e.target.value })} />
        </Field>
        <Field label="Notes for the reviewer" htmlFor="notes" optional>
          <Textarea id="notes" value={v.evidence_notes} onChange={(e) => setV({ ...v, evidence_notes: e.target.value })} />
        </Field>
        <div className="flex justify-end"><Button type="submit" variant="primary" loading={saving}>Submit for review</Button></div>
      </form>
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {!!list.data?.length && (
        <ul className="space-y-2">
          {list.data.map((x) => {
            const S = STATUS[x.status];
            return (
              <li key={x.id} className="flex items-center gap-3 rounded-2xl bg-card/70 p-3">
                <S.icon className="size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{x.title}</p>
                  <p className="text-xs text-ink-3">Requested {timeAgo(x.created_at)}</p>
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
      )}
    </Step>
  );
}
