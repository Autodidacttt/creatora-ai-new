"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Bot, Building2, CircleCheck, Copy, ExternalLink, FlaskConical, Mail, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import {
  addCompanyContact, decideCompany, findCompanyContacts, getCompanyVerification, inviteCompanyContact, type Suggestion,
} from "@/services/verification";
import { GlassPanel } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field, Input } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { StatusChip } from "@/components/admin/verification-status";
import { AuditList, DecisionBar, HistoryList, PhoneField } from "@/components/admin/verification-detail";
import { errorMessage, timeAgo } from "@/lib/utils";

const SOURCE = {
  gemini: { label: "AI Found Potential Contact", icon: Bot },
  demo_directory: { label: "Demo source, simulated", icon: FlaskConical },
  manual: { label: "Added by an admin", icon: UserPlus },
} as const;

type Draft = { suggestion_id: string | null; name: string; role: string; email: string };

export default function CompanyVerificationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const db = useDb();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "company-detail", id], queryFn: () => getCompanyVerification(db, id) });
  const [finding, setFinding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ link?: string; mode: string; demo_label?: string } | null>(null);
  const [manual, setManual] = useState({ name: "", role: "", email: "", source_url: "", note: "" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin"] }); };

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data;
  const pending = c.status === "pending";
  const impersonation = c.status === "rejected" && c.rejection_source === "company_contact";

  async function send() {
    if (!draft) return;
    setSending(true);
    try {
      const r = await inviteCompanyContact(id, draft);
      setSent(r);
      toast.success(r.mode === "demo" ? "Invitation created (demo — email not sent)" : `Invitation emailed to ${draft.email}`);
      refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setSending(false); }
  }

  return (
    <div className="space-y-5">
      <Link href="/admin/verifications?tab=companies" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Verifications</Link>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-card"><Building2 className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="display text-2xl">{c.company_name}</h1>
          <p className="text-sm text-ink-3">Applicant <Link href={`/u/${c.user.username}`} className="underline-offset-4 hover:underline">@{c.user.username}</Link> · submitted {timeAgo(c.created_at)}</p>
        </div>
        <StatusChip status={c.status} impersonation={impersonation} />
      </div>
      {impersonation && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> The company contact did not confirm this applicant. A high-priority report was opened — review it in Reports. The account was not suspended automatically.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <GlassPanel className="space-y-4 p-5 sm:p-6">
            <h2 className="display text-lg">Submitted details</h2>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">Website</dt><dd><a href={c.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">{c.website_domain} <ExternalLink className="size-3" /></a></dd>
              <dt className="text-ink-3">Applicant email</dt><dd>{c.company_email}</dd>
              <dt className="text-ink-3">Domain check</dt>
              <dd>{c.domain_match ? <Chip tone="success">Email domain matches the website</Chip>
                : c.free_mail ? <Chip tone="danger">Free-mail address ({c.email_domain})</Chip>
                : <Chip tone="amber">Email domain {c.email_domain} ≠ {c.website_domain}</Chip>}</dd>
              <dt className="text-ink-3">Registration no.</dt><dd>{c.registration_number ?? "—"}</dd>
              <dt className="text-ink-3">Address</dt><dd>{c.address}</dd>
              <dt className="text-ink-3">Industry</dt><dd>{c.industry ?? "—"}</dd>
              <dt className="text-ink-3">Applicant</dt><dd>{c.applicant_name} · {c.applicant_role}</dd>
              <dt className="text-ink-3">Relationship</dt><dd>{c.relationship}</dd>
              <dt className="text-ink-3">Phone</dt><dd><PhoneField kind="company" id={c.id} phone={c.phone} /></dd>
            </dl>
          </GlassPanel>

          <GlassPanel className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="display mr-auto text-lg">Official contact</h2>
              {pending && (
                <Button variant="secondary" loading={finding} onClick={async () => {
                  setFinding(true);
                  try { const r = await findCompanyContacts(id); setNote(r.note); refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setFinding(false); }
                }}><Search /> Find official contacts</Button>
              )}
            </div>
            <p className="text-xs text-ink-3">Only the company name, website, industry and address are used — never the applicant&apos;s personal data. Suggestions are advisory.</p>
            {note && <p className="rounded-2xl bg-card/70 px-3 py-2 text-sm" role="status">{note}</p>}
            <ul className="space-y-2">
              {c.suggestions.map((s) => <SuggestionCard key={s.id} s={s} disabled={!pending} onSelect={() => setDraft({ suggestion_id: s.id, name: s.name ?? "", role: s.role, email: s.public_business_email ?? "" })} />)}
            </ul>
            {pending && (
              <form className="space-y-2 rounded-2xl border border-dashed border-line p-3" onSubmit={async (e) => {
                e.preventDefault();
                try { await addCompanyContact(db, id, manual); setManual({ name: "", role: "", email: "", source_url: "", note: "" }); refresh(); toast.success("Contact added"); }
                catch (err) { toast.error(errorMessage(err)); }
              }}>
                <p className="text-sm font-semibold">Add a contact manually</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input aria-label="Name" placeholder="Name (optional)" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
                  <Input aria-label="Role" placeholder="Role, e.g. Legal" required value={manual.role} onChange={(e) => setManual({ ...manual, role: e.target.value })} />
                  <Input aria-label="Public business email" type="email" placeholder="Public business email" value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
                  <Input aria-label="Source URL" type="url" placeholder="Where you found it (https://…)" value={manual.source_url} onChange={(e) => setManual({ ...manual, source_url: e.target.value })} />
                </div>
                <div className="flex justify-end"><Button size="sm" type="submit" disabled={!manual.role.trim()}><UserPlus /> Add contact</Button></div>
              </form>
            )}
          </GlassPanel>

          <GlassPanel className="space-y-3 p-5 sm:p-6">
            <h2 className="display text-lg">Invitations</h2>
            {sent?.link && (
              <div className="space-y-2 rounded-2xl border border-dashed border-amber bg-amber-soft/50 p-3 text-sm" role="status">
                <p className="flex items-center gap-2 font-semibold"><FlaskConical className="size-4" /> {sent.demo_label} — copy the link for the demo:</p>
                <div className="flex gap-2">
                  <Input readOnly value={sent.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
                  <Button size="sm" onClick={() => { void navigator.clipboard.writeText(sent.link!); toast.success("Link copied"); }}><Copy /> Copy</Button>
                </div>
              </div>
            )}
            {c.invitations.length === 0 ? <p className="text-sm text-ink-3">No invitation sent yet.</p> : (
              <ul className="space-y-2">
                {c.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-card/70 p-3 text-sm">
                    <Mail className="size-4" />
                    <span className="min-w-0 flex-1">{i.contact_name ? `${i.contact_name} · ` : ""}{i.contact_role ? `${i.contact_role} · ` : ""}{i.contact_email}
                      <span className="block text-xs text-ink-3">{i.email_mode === "demo" ? "Demo, email not sent" : "Emailed"} · {timeAgo(i.created_at)} · expires {new Date(i.expires_at).toLocaleDateString()}{i.comment ? ` · “${i.comment}”` : ""}</span>
                    </span>
                    <Chip tone={i.status === "approved" ? "success" : i.status === "rejected" ? "danger" : i.status === "sent" ? "amber" : "outline"}>
                      {i.status === "sent" ? "🟡 Awaiting response" : i.status}
                    </Chip>
                    {pending && (i.status === "expired" || i.status === "cancelled") && (
                      <Button size="sm" variant="ghost" onClick={() => setDraft({ suggestion_id: null, name: i.contact_name ?? "", role: i.contact_role ?? "", email: i.contact_email })}>Resend</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>

          <GlassPanel className="space-y-3 p-5 sm:p-6">
            <h2 className="display text-lg">Decision</h2>
            {pending ? (
              <>
                <p className="text-xs text-ink-3">Usually the company contact&apos;s answer decides. You can also decide directly; never auto-label impersonation without evidence.</p>
                <DecisionBar onDecide={async (d, reason) => { await decideCompany(db, id, d, reason); toast.success(d === "verified" ? "Marked Verified Company" : "Rejected"); refresh(); }} />
              </>
            ) : (
              <p className="flex items-center gap-2 text-sm"><CircleCheck className="size-4" /> {c.status === "verified" ? "Verified Company" : "Rejected"} {c.reviewed_at ? timeAgo(c.reviewed_at) : ""}{c.reason ? ` — ${c.reason}` : ""}</p>
            )}
          </GlassPanel>
        </div>
        <div className="space-y-5">
          <GlassPanel className="space-y-2 p-5"><h2 className="display text-lg">History</h2><HistoryList items={c.history} /></GlassPanel>
          <GlassPanel className="space-y-2 p-5"><h2 className="display text-lg">Audit log</h2><AuditList items={c.log} /></GlassPanel>
        </div>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)} title="Send the confirmation request" size="sm">
        {draft && (
          <div className="space-y-3">
            <Field label="Contact email" htmlFor="inv-email" hint="Use a public business address — never a guessed one">
              <Input id="inv-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Contact name" placeholder="Name (optional)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input aria-label="Contact role" placeholder="Role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            </div>
            <p className="rounded-2xl bg-amber-soft/60 px-3 py-2 text-sm font-medium">You are about to email {draft.email || "…"}.</p>
            <p className="text-xs text-ink-3">They get a single-use link (expires in 7 days) asking whether {c.applicant_name} ({c.applicant_role}) may represent {c.company_name}.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="primary" loading={sending} disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)} onClick={async () => { await send(); setDraft(null); }}><Mail /> Send</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function SuggestionCard({ s, onSelect, disabled }: { s: Suggestion; onSelect: () => void; disabled: boolean }) {
  const src = SOURCE[s.source];
  return (
    <li className="space-y-1.5 rounded-2xl bg-card/70 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink-2"><src.icon className="size-3.5" /> {src.label}{s.selected && <Chip tone="success">Selected</Chip>}</p>
      <p className="font-semibold">{s.name ? `${s.name} · ` : ""}{s.role}</p>
      {s.public_business_email && <p className="font-mono text-xs">{s.public_business_email}</p>}
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
        {s.source_title}
        {s.source_url && <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 underline">View Source <ExternalLink className="size-3" /></a>}
      </p>
      {s.note && <p className="text-xs text-ink-2">{s.note}</p>}
      {s.source !== "manual" && <p className="text-[11px] text-ink-3">Verify this source yourself. AI can be wrong.</p>}
      {!disabled && <Button size="sm" variant="secondary" onClick={onSelect}>Select</Button>}
    </li>
  );
}
