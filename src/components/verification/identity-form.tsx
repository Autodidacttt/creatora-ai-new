"use client";

import { useState } from "react";
import { Clock, CircleCheck, FlaskConical, IdCard, XCircle } from "lucide-react";
import { toast } from "sonner";
import { submitIdentityVerification, type MyVerification } from "@/services/verification";
import { ID_IMAGE, ID_TYPES } from "@/config/verification";
import { Field, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

/** Government-ID verification (creators and individual recruiters). The trust team decides; the ID check is advisory. */
export function IdentityForm({ status, onSubmitted }: { status: MyVerification; onSubmitted: () => void }) {
  const [v, setV] = useState({ full_name: "", id_type: "national_id", id_number: "", dob: "" });
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = status.identity;

  if (status.identity_verified) {
    return <p className="flex items-center gap-2 text-sm"><CircleCheck className="size-4 text-success" /> <strong>Identity Verified</strong> by the Creatora trust team.</p>;
  }
  if (id?.status === "pending") {
    return (
      <div className="space-y-1 text-sm" role="status">
        <p className="flex items-center gap-2"><Clock className="size-4 text-amber-ink" /> <strong>Pending review</strong> · submitted {new Date(id.submitted_at).toLocaleDateString()}</p>
        {id.mock_result && <p className="text-xs text-ink-3">Automated ID check: {id.mock_result} — <em>Simulated check, not a government verification</em>. A trust-team member makes the decision.</p>}
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Upload a photo of your government ID.");
    if (file.size > ID_IMAGE.maxBytes) return setError("The image must be 5 MB or smaller.");
    const form = new FormData();
    Object.entries(v).forEach(([k, x]) => form.append(k, x));
    form.append("consent", String(consent));
    form.append("id_image", file);
    setBusy(true); setError(null);
    try {
      await submitIdentityVerification(form);
      toast.success("Submitted — the trust team will review it");
      onSubmitted();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  const noPhone = !status.phone;
  const noAttempts = status.identity_attempts_left <= 0;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {id?.status === "rejected" && (
        <p className="flex items-start gap-2 rounded-2xl bg-danger/10 px-3 py-2 text-sm text-danger" role="status">
          <XCircle className="mt-0.5 size-4 shrink-0" /> Not approved{id.reason ? `: ${id.reason}` : ""}. {noAttempts ? "No attempts left — contact support." : `You can resubmit (${status.identity_attempts_left} attempt${status.identity_attempts_left === 1 ? "" : "s"} left).`}
        </p>
      )}
      {status.config.demo_id_notice && (
        <div className="space-y-2 rounded-2xl border border-dashed border-amber bg-amber-soft/50 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" /> Hackathon demo: use the sample IDs provided, not real government ID numbers.</p>
          <div className="flex flex-wrap gap-1.5">
            {status.config.sample_identities.map((s) => (
              <button key={s.id_number} type="button" onClick={() => setV({ ...v, full_name: s.name, id_number: s.id_number, dob: s.dob })}
                className="rounded-full border border-line bg-card px-2.5 py-1 text-xs hover:border-amber" title={`${s.name} · ${s.id_number} · ${s.dob}`}>
                {s.name} · {s.id_number}
              </button>
            ))}
          </div>
        </div>
      )}
      <fieldset disabled={noPhone || noAttempts || busy} className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name (as on the ID)" htmlFor="id-name"><Input id="id-name" autoComplete="name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label="ID type" htmlFor="id-type">
          <Select id="id-type" value={v.id_type} onChange={(e) => setV({ ...v, id_type: e.target.value })}>
            {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="ID number" htmlFor="id-number" hint="Stored only as a one-way hash plus the last 4 characters">
          <Input id="id-number" autoComplete="off" value={v.id_number} onChange={(e) => setV({ ...v, id_number: e.target.value })} />
        </Field>
        <Field label="Date of birth" htmlFor="id-dob"><Input id="id-dob" type="date" value={v.dob} onChange={(e) => setV({ ...v, dob: e.target.value })} /></Field>
        <Field label="Phone" htmlFor="id-phone" hint={noPhone ? "Verify your phone above first" : "Verified by OTP"}>
          <Input id="id-phone" value={status.phone?.masked ?? "Not verified yet"} readOnly />
        </Field>
        <Field label="Photo of the government ID" htmlFor="id-image" hint="JPEG, PNG or WebP · up to 5 MB · private, deleted after the review">
          <Input id="id-image" type="file" accept={ID_IMAGE.types.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </fieldset>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-amber" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={noPhone || noAttempts} />
        <span>
          I consent to Creatora processing this information to verify my identity.
          <span className="mt-1 block text-xs text-ink-3">
            Privacy notice: your ID number is stored only as a hash plus its last 4 characters. Your date of birth and ID image are kept in
            restricted storage, seen only by trust-team members with permission (every view is logged), and the image is deleted
            {` ${status.config.retention_days}`} days after the decision. We never contact government databases.
          </span>
        </span>
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy} disabled={noPhone || noAttempts || !consent}><IdCard /> Submit for review</Button>
      </div>
    </form>
  );
}
