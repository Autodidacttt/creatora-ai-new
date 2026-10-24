"use client";

import { useState } from "react";
import { Building2, CircleCheck, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { submitCompanyVerification, type MyVerification } from "@/services/verification";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

const EMPTY = { company_name: "", website: "", company_email: "", registration_number: "", address: "", industry: "", applicant_name: "", applicant_role: "", relationship: "" };

/** Company / Organization verification. An official contact (found by the trust team) confirms the applicant. */
export function CompanyForm({ status, onSubmitted }: { status: MyVerification; onSubmitted: () => void }) {
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = status.company;

  if (status.company_verified) {
    return <p className="flex items-center gap-2 text-sm"><CircleCheck className="size-4 text-success" /> <strong>Verified Company</strong>{c ? ` · ${c.company_name}` : ""}</p>;
  }
  if (c?.status === "pending") {
    return (
      <div className="space-y-1 text-sm" role="status">
        <p className="flex items-center gap-2"><Clock className="size-4 text-amber-ink" /> <strong>Company Verification Pending</strong> · {c.company_name}</p>
        <p className="text-xs text-ink-3">The trust team contacts an official representative of the company to confirm you. This can take a few days.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await submitCompanyVerification(v);
      toast.success(r.domain_match ? "Submitted — your email domain matches the website" : "Submitted — the trust team will review it");
      onSubmitted();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const noPhone = !status.phone;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {c?.status === "rejected" && (
        <p className="flex items-start gap-2 rounded-2xl bg-danger/10 px-3 py-2 text-sm text-danger" role="status">
          <XCircle className="mt-0.5 size-4 shrink-0" /> Verification rejected. If you think this is a mistake, contact support from the Help page.
        </p>
      )}
      <fieldset disabled={noPhone || busy} className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name" htmlFor="co-name"><Input id="co-name" autoComplete="organization" value={v.company_name} onChange={set("company_name")} /></Field>
        <Field label="Website" htmlFor="co-web"><Input id="co-web" type="url" placeholder="https://company.com" value={v.website} onChange={set("website")} /></Field>
        <Field label="Your company email" htmlFor="co-email" hint="We check that its domain matches the website"><Input id="co-email" type="email" autoComplete="email" value={v.company_email} onChange={set("company_email")} /></Field>
        <Field label="Registration number" htmlFor="co-reg" optional><Input id="co-reg" value={v.registration_number} onChange={set("registration_number")} /></Field>
        <Field label="Industry" htmlFor="co-ind" optional><Input id="co-ind" value={v.industry} onChange={set("industry")} /></Field>
        <Field label="Company address" htmlFor="co-addr"><Input id="co-addr" autoComplete="street-address" value={v.address} onChange={set("address")} /></Field>
        <Field label="Your name" htmlFor="co-app"><Input id="co-app" autoComplete="name" value={v.applicant_name} onChange={set("applicant_name")} /></Field>
        <Field label="Your designation / role" htmlFor="co-role"><Input id="co-role" autoComplete="organization-title" value={v.applicant_role} onChange={set("applicant_role")} /></Field>
        <Field label="Phone" htmlFor="co-phone" hint={noPhone ? "Verify your phone above first" : "Verified by OTP"}><Input id="co-phone" value={status.phone?.masked ?? "Not verified yet"} readOnly /></Field>
        <Field label="Your relationship with the company" htmlFor="co-rel" className="sm:col-span-2">
          <Textarea id="co-rel" rows={2} placeholder="e.g. Employee in the marketing team since 2023" value={v.relationship} onChange={set("relationship")} />
        </Field>
      </fieldset>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy} disabled={noPhone}><Building2 /> Submit for verification</Button></div>
    </form>
  );
}
