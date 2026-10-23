"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarDays, ClipboardList, FileSignature, Handshake, ListTodo, Repeat, Send, UserCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { Message, Negotiation, OfferTerms } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { USAGE_RIGHTS } from "@/config/constants";
import { acceptOffer, acceptProposalAndHire, rejectProposal, sendFinalProposal, sendOffer } from "@/services/messaging";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip, ToggleChip } from "@/components/ui/chip";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { Stepper } from "@/components/ui/stepper";
import { cn, errorMessage } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/money";

const RIGHT_LABEL = Object.fromEntries(USAGE_RIGHTS.map((r) => [r.value, r.label])) as Record<string, string>;

const STATE: Record<Negotiation["state"], { label: string; tone: "neutral" | "amber" | "success" | "dark" }> = {
  open: { label: "No offer yet", tone: "neutral" },
  negotiating: { label: "Negotiating", tone: "amber" },
  agreed: { label: "Terms agreed", tone: "success" },
  proposal_sent: { label: "Final proposal sent", tone: "amber" },
  hired: { label: "Hired", tone: "dark" },
};

function TermsList({ price, currency, terms, className }: { price: number; currency: string; terms: OfferTerms; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs", className)}>
      <dt className="text-ink-3">Price</dt><dd className="font-semibold tabular-nums">{formatMoney(price, currency)}</dd>
      <dt className="text-ink-3">Deliverables</dt><dd className="whitespace-pre-line">{terms.deliverables}</dd>
      <dt className="text-ink-3">Deadline</dt><dd>{terms.deadline ? formatDate(terms.deadline) : "Not set"}</dd>
      <dt className="text-ink-3">Revisions</dt><dd>{terms.revisions}</dd>
      <dt className="text-ink-3">Usage</dt><dd>{terms.usage_rights.length ? terms.usage_rights.map((r) => RIGHT_LABEL[r] ?? r).join(", ") : "None"}</dd>
    </dl>
  );
}

const useRefresh = (conversationId: string) => {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["negotiation", conversationId] });
    qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    ["applications", "pipeline", "campaign", "hiring", "deliveries", "my-projects", "inbox"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
};

// ---------------------------------------------------------------------------
// Offer composer (new offer or counter-offer)
// ---------------------------------------------------------------------------
export function OfferDialog({ open, onOpenChange, conversationId, n, initial, counter }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversationId: string;
  n: Negotiation;
  initial: { price: number | null; terms: OfferTerms };
  counter?: boolean;
}) {
  const db = useDb();
  const refresh = useRefresh(conversationId);
  const [price, setPrice] = useState(initial.price ? String(initial.price) : "");
  const [terms, setTerms] = useState<OfferTerms>(initial.terms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof OfferTerms>(k: K, v: OfferTerms[K]) => setTerms((t) => ({ ...t, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const p = Number(price);
    if (!Number.isInteger(p) || p < 1) return setError("Enter a whole price greater than zero");
    if (!terms.deliverables.trim()) return setError("Describe the deliverables");
    setBusy(true);
    setError(null);
    try {
      await sendOffer(db, conversationId, p, { ...terms, deliverables: terms.deliverables.trim() });
      toast.success(counter ? "Counter-offer sent" : "Offer sent");
      refresh();
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={counter ? "Counter-offer" : "Make an offer"} size="md"
      description={`For “${n.campaign.title}”. The other side can accept it or counter. Terms are agreed when both accept the same offer.`}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label={`Price (${n.campaign.currency})`} htmlFor="of-price" error={error}>
            <Input id="of-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))} placeholder="e.g. 1200" autoFocus />
          </Field>
          <Field label="Revisions" htmlFor="of-rev">
            <Stepper id="of-rev" value={terms.revisions} onChange={(v) => set("revisions", v)} min={0} max={20} />
          </Field>
        </div>
        <Field label="Deliverables" htmlFor="of-del">
          <Textarea id="of-del" rows={3} maxLength={1000} value={terms.deliverables} onChange={(e) => set("deliverables", e.target.value)} placeholder="e.g. 3 vertical reels (9:16, 15s) + 6 stills" />
        </Field>
        <Field label="Deadline" htmlFor="of-dl" optional>
          <Input id="of-dl" type="date" value={terms.deadline ?? ""} onChange={(e) => set("deadline", e.target.value || null)} />
        </Field>
        <Field label="Usage rights">
          <div className="flex flex-wrap gap-2">
            {USAGE_RIGHTS.map((r) => (
              <ToggleChip key={r.value} selected={terms.usage_rights.includes(r.value)}
                onClick={() => set("usage_rights", terms.usage_rights.includes(r.value) ? terms.usage_rights.filter((x) => x !== r.value) : [...terms.usage_rights, r.value])}>
                {r.label}
              </ToggleChip>
            ))}
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{counter ? <Repeat /> : <Send />} {counter ? "Send counter-offer" : "Send offer"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Creator: final proposal (prefilled from the agreed terms; the server copies them, so they can't drift)
// ---------------------------------------------------------------------------
function FinalProposalDialog({ open, onOpenChange, conversationId, n }: { open: boolean; onOpenChange: (o: boolean) => void; conversationId: string; n: Negotiation }) {
  const db = useDb();
  const refresh = useRefresh(conversationId);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const o = n.latest_offer;
  if (!o?.terms || o.price == null) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Send final proposal" size="md"
      description="Built from the terms you both accepted. The brand hires you by accepting it.">
      <div className="space-y-4">
        <TermsList price={o.price} currency={o.currency ?? n.campaign.currency} terms={o.terms} className="rounded-2xl bg-card/70 p-3" />
        <Field label="Note to the brand" htmlFor="fp-note" optional>
          <Textarea id="fp-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything they should know before accepting" />
        </Field>
        <p className="text-[11px] text-ink-3">Need different terms? Close this and send a counter-offer instead.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await sendFinalProposal(db, conversationId, note.trim() || null);
              toast.success("Final proposal sent");
              refresh();
              onOpenChange(false);
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}><FileSignature /> Send final proposal</Button>
        </div>
      </div>
    </Dialog>
  );
}

function defaults(n: Negotiation): { price: number | null; terms: OfferTerms } {
  const o = n.latest_offer;
  if (o?.terms) return { price: o.price ?? null, terms: o.terms };
  return {
    price: n.application?.proposed_rate ?? n.campaign.budget_max ?? n.campaign.budget_min ?? null,
    terms: { deliverables: n.campaign.deliverables ?? "", deadline: n.campaign.deadline, revisions: 2, usage_rights: n.campaign.usage_rights ?? [] },
  };
}

// ---------------------------------------------------------------------------
// Pinned context card
// ---------------------------------------------------------------------------
export function NegotiationCard({ conversationId, n }: { conversationId: string; n: Negotiation }) {
  const db = useDb();
  const me = useMe();
  const refresh = useRefresh(conversationId);
  const [offerOpen, setOfferOpen] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isBrand = me.id === n.brand_id;
  const state = STATE[n.state];
  const c = n.campaign;
  const proposedPrice = n.application?.proposed_rate;
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };

  return (
    <section aria-label="Hiring terms" className="space-y-3 rounded-[1.5rem] border border-line bg-card p-3.5 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Brief</p>
          <Link href={`/campaigns/${c.id}`} className="block truncate font-semibold hover:underline">{c.title}</Link>
          <p className="line-clamp-2 text-xs text-ink-2">{c.description}</p>
        </div>
        <Chip tone={state.tone} icon={n.state === "hired" ? <BadgeCheck /> : <Handshake />}>{state.label}</Chip>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span>Budget: <b className="text-ink">{c.budget_min != null || c.budget_max != null ? `${formatMoney(c.budget_min ?? c.budget_max, c.currency)}${c.budget_max != null && c.budget_min != null && c.budget_max !== c.budget_min ? ` – ${formatMoney(c.budget_max, c.currency)}` : ""}` : "Open"}</b></span>
        <span>Creator&apos;s proposal: <b className="text-ink">{proposedPrice != null ? formatMoney(proposedPrice, c.currency) : "—"}</b></span>
        {n.latest_offer?.price != null && <span>Latest offer: <b className="text-ink">{formatMoney(n.latest_offer.price, n.latest_offer.currency ?? c.currency)}</b> ({n.latest_offer.status})</span>}
        {c.deadline && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" /> {formatDate(c.deadline)}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {n.state === "hired" ? (
          n.project && (
            <Link href={isBrand ? `/brand/campaigns/projects/${n.project.id}` : `/opportunities/projects/${n.project.id}`} className={buttonVariants({ size: "sm", variant: "dark" })}>
              <ClipboardList /> Open project
            </Link>
          )
        ) : (
          <>
            {n.state === "proposal_sent" && n.proposal && isBrand && (
              <>
                <Button size="sm" variant="primary" loading={busy === "hire"} onClick={() => act("hire", () => acceptProposalAndHire(db, n.proposal!.id), "Hired — the brief is final for this creator")}>
                  <UserCheck /> Accept &amp; hire · {formatMoney(n.proposal.price, n.proposal.currency)}
                </Button>
                <Button size="sm" variant="ghost" loading={busy === "reject"} onClick={() => act("reject", () => rejectProposal(db, n.proposal!.id, null), "Proposal declined")}><XCircle /> Decline</Button>
              </>
            )}
            {n.state === "agreed" && !isBrand && (
              <Button size="sm" variant="primary" onClick={() => setFinalOpen(true)}><FileSignature /> Send final proposal</Button>
            )}
            {n.state === "agreed" && isBrand && <p className="self-center text-xs text-ink-2">Waiting for the creator&apos;s final proposal.</p>}
            {n.state === "proposal_sent" && !isBrand && <p className="self-center text-xs text-ink-2">Proposal sent — waiting for the brand to accept.</p>}
            {c.status !== "completed" && (
              <Button size="sm" variant="secondary" onClick={() => setOfferOpen(true)}><Send /> {n.latest_offer ? "New offer" : "Make an offer"}</Button>
            )}
          </>
        )}
      </div>
      {offerOpen && <OfferDialog open onOpenChange={setOfferOpen} conversationId={conversationId} n={n} initial={defaults(n)} />}
      {finalOpen && <FinalProposalDialog open onOpenChange={setFinalOpen} conversationId={conversationId} n={n} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Structured message cards
// ---------------------------------------------------------------------------
const OFFER_STATUS: Record<string, { label: string; tone: "neutral" | "amber" | "success" | "dark" | "danger" }> = {
  open: { label: "Open", tone: "amber" },
  accepted: { label: "Accepted", tone: "success" },
  countered: { label: "Replaced", tone: "neutral" },
  sent: { label: "Waiting for the brand", tone: "amber" },
  rejected: { label: "Declined", tone: "danger" },
  superseded: { label: "Replaced", tone: "neutral" },
};

export function StructuredMessage({ m, mine, n, conversationId }: { m: Message; mine: boolean; n: Negotiation | null | undefined; conversationId: string }) {
  const db = useDb();
  const refresh = useRefresh(conversationId);
  const [busy, setBusy] = useState(false);
  const [counterOpen, setCounterOpen] = useState(false);
  const p = m.payload ?? {};
  const status = OFFER_STATUS[p.status ?? ""] ?? { label: p.status ?? "", tone: "neutral" as const };
  const time = new Date(m.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (m.kind === "task") {
    return (
      <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
        <div className="max-w-[85%] rounded-3xl border border-line bg-card px-4 py-3 text-sm shadow-sm">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-3"><ListTodo className="size-3.5" /> {p.scope === "group" ? "Group task" : "Task"}</p>
          <p className="mt-1 font-semibold">{p.title}</p>
          {p.due_date && <p className="text-xs text-ink-2">Due {formatDate(p.due_date)}</p>}
          <span className="mt-1 block text-right text-[10px] text-ink-3">{time}</span>
        </div>
      </div>
    );
  }

  const isOffer = m.kind === "offer";
  const latestOfferId = n?.latest_offer?.message_id;
  const canAccept = isOffer && !mine && p.status === "open" && latestOfferId === m.id && n?.state !== "hired";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("w-full max-w-[85%] rounded-3xl border px-4 py-3 shadow-sm sm:max-w-md", mine ? "border-amber/50 bg-amber-soft/70" : "border-line bg-card")}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">
            {isOffer ? <Handshake className="size-3.5" /> : <FileSignature className="size-3.5" />}
            {isOffer ? `Offer from the ${p.by ?? (mine ? "you" : "other side")}` : `Final proposal v${p.version ?? 1}`}
          </p>
          {p.status && <Chip tone={status.tone} className="px-2 py-0.5 text-[10px]">{status.label}</Chip>}
        </div>
        {p.terms && p.price != null && <TermsList price={p.price} currency={p.currency ?? "USD"} terms={p.terms} className="mt-2" />}
        {p.note && <p className="mt-2 whitespace-pre-line text-xs italic text-ink-2">“{p.note}”</p>}
        {canAccept && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={async () => {
              setBusy(true);
              try { await acceptOffer(db, m.id); toast.success("Offer accepted — terms agreed"); refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
            }}><BadgeCheck /> Accept</Button>
            <Button size="sm" variant="secondary" onClick={() => setCounterOpen(true)}><Repeat /> Counter</Button>
          </div>
        )}
        <span className="mt-1 block text-right text-[10px] text-ink-3">{time}</span>
        {counterOpen && n && p.terms && (
          <OfferDialog open onOpenChange={setCounterOpen} conversationId={conversationId} n={n} counter initial={{ price: p.price ?? null, terms: p.terms }} />
        )}
      </div>
    </div>
  );
}
