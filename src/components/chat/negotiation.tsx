"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CalendarDays, ClipboardList, FileSignature, Handshake, Hourglass, ListTodo, Lock, Repeat, Send, UserCheck } from "lucide-react";
import { toast } from "sonner";
import type { Message, Negotiation, OfferTerms } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { USAGE_RIGHTS } from "@/config/constants";
import { acceptOffer, hireFromAgreement, sendOffer } from "@/services/messaging";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip, ToggleChip } from "@/components/ui/chip";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { cn, errorMessage } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/money";

const RIGHT_LABEL = Object.fromEntries(USAGE_RIGHTS.map((r) => [r.value, r.label])) as Record<string, string>;

const STATE: Record<Negotiation["state"], { label: string; tone: "neutral" | "amber" | "success" | "dark" }> = {
  open: { label: "No offer yet", tone: "neutral" },
  negotiating: { label: "Negotiating", tone: "amber" },
  agreed: { label: "Terms agreed", tone: "success" },
  awaiting_funding: { label: "Hired · awaiting funding", tone: "amber" },
  hired: { label: "Hired", tone: "dark" },
};

function TermsList({ price, currency, terms, className }: { price: number; currency: string; terms: OfferTerms; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs", className)}>
      <dt className="text-ink-3">Price</dt><dd className="font-semibold tabular-nums">{formatMoney(price, currency)}</dd>
      <dt className="text-ink-3">Deliverables</dt><dd className="whitespace-pre-line">{terms.deliverables}</dd>
      <dt className="text-ink-3">Deadline</dt><dd>{terms.deadline ? formatDate(terms.deadline) : "Not set"}</dd>
      <dt className="text-ink-3">Usage</dt><dd>{terms.usage_rights?.length ? terms.usage_rights.map((r) => RIGHT_LABEL[r] ?? r).join(", ") : "None"}</dd>
    </dl>
  );
}

const useRefresh = (conversationId: string) => {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["negotiation", conversationId] });
    qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    ["applications", "pipeline", "campaign", "hiring", "deliveries", "my-projects", "inbox", "collaborators"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
};

/** Brand: hire from the accepted agreement, then go straight to "Fund project" (nothing continues until it's funded). */
function useHire(conversationId: string) {
  const db = useDb();
  const router = useRouter();
  const refresh = useRefresh(conversationId);
  const [busy, setBusy] = useState(false);
  const hire = async (proposalId: string) => {
    setBusy(true);
    try {
      const projectId = await hireFromAgreement(db, proposalId);
      toast.success("Hired — fund the project so work can start");
      refresh();
      router.push(`/brand/campaigns/projects/${projectId}?fund=1`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  return { hire, busy };
}

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
  const [terms, setTerms] = useState<OfferTerms>({ deliverables: initial.terms.deliverables ?? "", deadline: initial.terms.deadline ?? null, usage_rights: initial.terms.usage_rights ?? [] });
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
      description={`For “${n.campaign.title}”. When the other side accepts it, that's the agreement and the brand can hire.`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={`Price (${n.campaign.currency})`} htmlFor="of-price" error={error}>
          <Input id="of-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))} placeholder="e.g. 1200" autoFocus />
        </Field>
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

function defaults(n: Negotiation): { price: number | null; terms: OfferTerms } {
  const o = n.latest_offer;
  if (o?.terms) return { price: o.price ?? null, terms: o.terms };
  return {
    price: n.application?.proposed_rate ?? n.campaign.budget_max ?? n.campaign.budget_min ?? null,
    terms: { deliverables: n.campaign.deliverables ?? "", deadline: n.campaign.deadline, usage_rights: n.campaign.usage_rights ?? [] },
  };
}

// ---------------------------------------------------------------------------
// Pinned context card
// ---------------------------------------------------------------------------
export function NegotiationCard({ conversationId, n }: { conversationId: string; n: Negotiation }) {
  const me = useMe();
  const { hire, busy } = useHire(conversationId);
  const [offerOpen, setOfferOpen] = useState(false);
  const isBrand = me.id === n.brand_id;
  const state = STATE[n.state];
  const c = n.campaign;
  const proposedPrice = n.application?.proposed_rate;
  const agreement = n.state === "agreed" && n.proposal?.status === "accepted" ? n.proposal : null;
  const projectHref = n.project && (isBrand ? `/brand/campaigns/projects/${n.project.id}` : `/opportunities/projects/${n.project.id}`);

  return (
    <section aria-label="Hiring terms" className="space-y-3 rounded-[1.5rem] border border-line bg-card p-3.5 shadow-sm">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-ink-3">Brief</p>
          <Link href={`/campaigns/${c.id}`} className="block truncate font-semibold hover:underline">{c.title}</Link>
          <p className="line-clamp-2 text-xs text-ink-2">{c.description}</p>
        </div>
        <Chip tone={state.tone} icon={n.state === "hired" ? <BadgeCheck /> : n.state === "awaiting_funding" ? <Hourglass /> : <Handshake />}>{state.label}</Chip>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <span>Budget: <b className="text-ink">{c.budget_min != null || c.budget_max != null ? `${formatMoney(c.budget_min ?? c.budget_max, c.currency)}${c.budget_max != null && c.budget_min != null && c.budget_max !== c.budget_min ? ` – ${formatMoney(c.budget_max, c.currency)}` : ""}` : "Open"}</b></span>
        <span>Creator&apos;s proposal: <b className="text-ink">{proposedPrice != null ? formatMoney(proposedPrice, c.currency) : "—"}</b></span>
        {agreement && <span>Agreed: <b className="text-ink">{formatMoney(agreement.price, agreement.currency)}</b> (v{agreement.version})</span>}
        {!agreement && n.latest_offer?.price != null && <span>Latest offer: <b className="text-ink">{formatMoney(n.latest_offer.price, n.latest_offer.currency ?? c.currency)}</b> ({n.latest_offer.status})</span>}
        {c.deadline && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" /> {formatDate(c.deadline)}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {n.state === "hired" && projectHref && (
          <Link href={projectHref} className={buttonVariants({ size: "sm", variant: "dark" })}><ClipboardList /> Open project</Link>
        )}
        {n.state === "awaiting_funding" && projectHref && (isBrand ? (
          <Link href={`${projectHref}?fund=1`} className={buttonVariants({ size: "sm", variant: "primary" })}><Lock /> Fund project</Link>
        ) : (
          <>
            <p className="text-xs text-ink-2">Hired — waiting for the brand to fund the project before work starts.</p>
            <Link href={projectHref} className={buttonVariants({ size: "sm", variant: "ghost" })}><ClipboardList /> Project</Link>
          </>
        ))}
        {agreement && (isBrand ? (
          <Button size="sm" variant="primary" loading={busy} onClick={() => hire(agreement.id)}>
            <UserCheck /> Hire · {formatMoney(agreement.price, agreement.currency)}
          </Button>
        ) : <p className="text-xs text-ink-2">Terms agreed — the brand can hire you now.</p>)}
        {(n.state === "open" || n.state === "negotiating" || n.state === "agreed") && c.status !== "completed" && (
          <Button size="sm" variant="secondary" onClick={() => setOfferOpen(true)}><Send /> {n.latest_offer ? (agreement ? "Change terms" : "New offer") : "Make an offer"}</Button>
        )}
      </div>
      {agreement && <p className="text-[11px] text-ink-3">A new offer replaces this agreement until both sides accept again.</p>}
      {offerOpen && <OfferDialog open onOpenChange={setOfferOpen} conversationId={conversationId} n={n} initial={defaults(n)} />}
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
  sent: { label: "Sent", tone: "amber" },
  rejected: { label: "Declined", tone: "danger" },
  superseded: { label: "Replaced", tone: "neutral" },
};

export function StructuredMessage({ m, mine, n, conversationId }: { m: Message; mine: boolean; n: Negotiation | null | undefined; conversationId: string }) {
  const db = useDb();
  const me = useMe();
  const refresh = useRefresh(conversationId);
  const { hire, busy: hiring } = useHire(conversationId);
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
  const canAccept = isOffer && !mine && p.status === "open" && latestOfferId === m.id && n?.state !== "hired" && n?.state !== "awaiting_funding";
  // The accepted latest offer is the agreement: the brand hires right from it
  const canHire = isOffer && p.status === "accepted" && latestOfferId === m.id && n?.state === "agreed"
    && n.proposal?.status === "accepted" && me.id === n.brand_id;
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("w-full max-w-[85%] rounded-3xl border px-4 py-3 shadow-sm sm:max-w-md", mine ? "border-amber/50 bg-amber-soft/70" : "border-line bg-card")}>
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-3">
            {isOffer ? <Handshake className="size-3.5" /> : <FileSignature className="size-3.5" />}
            {isOffer ? `Offer from the ${p.by ?? (mine ? "you" : "other side")}` : `Proposal v${p.version ?? 1}`}
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
        {canHire && (
          <div className="mt-3">
            <Button size="sm" variant="primary" loading={hiring} onClick={() => hire(n!.proposal!.id)}><UserCheck /> Hire at {formatMoney(p.price ?? 0, p.currency ?? "USD")}</Button>
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
