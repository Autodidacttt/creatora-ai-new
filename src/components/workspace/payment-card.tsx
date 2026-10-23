"use client";

import { useState } from "react";
import Link from "next/link";
import { Award, CircleDollarSign, Download, FlaskConical, Lock, RotateCcw, Scale, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { PaymentEvent, ProjectSummary } from "@/types/workspace";
import { useDb } from "@/features/session";
import { certificatePdfUrl, disputeEscrow, fundEscrow, receiptPdfUrl, refundEscrow, releasePayment } from "@/services/workspace";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Field, Textarea } from "@/components/ui/field";
import { errorMessage } from "@/lib/utils";
import { formatDateTime, formatMoney } from "@/lib/money";
import { EscrowChip } from "./status";

export function ReasonDialog({ open, onOpenChange, title, description, cta, min = 5, onSubmit, danger }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  cta: string;
  min?: number;
  danger?: boolean;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description} size="sm">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < min) return setError(`Add at least ${min} characters`);
        setBusy(true);
        setError(null);
        try {
          await onSubmit(reason.trim());
          setReason("");
          onOpenChange(false);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}>
        <Field label="Reason" htmlFor="reason" error={error}>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>{cta}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Escrow status, ledger and the next payment action for the viewer's role. Internal test mode only. */
export function PaymentCard({ project, payments, role, onChanged, onSetAmount }: {
  project: ProjectSummary;
  payments?: PaymentEvent[];
  role: "creator" | "brand" | "admin";
  onChanged: () => void;
  onSetAmount?: () => void;
}) {
  const db = useDb();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"refund" | "dispute" | "fund" | null>(null);
  const e = project.escrow;
  const s = project.status;
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="glass space-y-4 rounded-[1.75rem] p-5" aria-labelledby={`pay-${project.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`pay-${project.id}`} className="flex items-center gap-2 text-sm font-semibold"><Wallet className="size-4" /> Payment</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
          <FlaskConical className="size-3.5" aria-hidden /> Test mode · no real money moves
        </span>
      </div>

      {e ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="display text-3xl tabular-nums">{formatMoney(e.amount, e.currency)}</p>
            <p className="text-xs text-ink-2">
              {role === "brand"
                ? <>+ {formatMoney(e.platform_fee, e.currency)} platform fee · you pay {formatMoney(e.amount + e.platform_fee, e.currency)}</>
                : <>Agreed fee — paid to you in full on release</>}
            </p>
          </div>
          <EscrowChip status={e.status} />
        </div>
      ) : (
        <p className="text-sm text-ink-2">
          {project.hired_at ? "No amount agreed yet." : "Payment is set up when the brand hires you."}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {role === "brand" && !e && project.hired_at && onSetAmount && (
          <Button variant="primary" onClick={onSetAmount} title="Agree the fee in chat; accepting the final proposal opens escrow"><Wallet /> Agree the fee in chat</Button>
        )}
        {role === "brand" && e?.status === "unfunded" && !["rejected", "cancelled", "completed"].includes(s) && (
          <Button variant="primary" loading={busy === "fund"} onClick={() => setDialog("fund")}><Lock /> Fund escrow</Button>
        )}
        {role === "brand" && e?.status === "funded" && s === "approved" && (
          <Button variant="primary" loading={busy === "release"} onClick={() => run("release", async () => {
            const r = await releasePayment(project.id);
            toast.message(`Licence record ${r.certificate_id} issued`);
          }, "Payment released — project complete")}>
            <CircleDollarSign /> Release payment & complete
          </Button>
        )}
        {role === "brand" && e?.status === "funded" && ["rejected", "cancelled"].includes(s) && (
          <Button variant="secondary" onClick={() => setDialog("refund")}><RotateCcw /> Refund escrow</Button>
        )}
        {role === "creator" && e?.status === "funded" && (
          <Button variant="ghost" size="sm" onClick={() => setDialog("dispute")}><Scale /> Open a dispute</Button>
        )}
        {e?.status === "released" && (
          <a href={receiptPdfUrl(project.id)} className={buttonVariants({ variant: role === "creator" ? "primary" : "secondary", size: "sm" })}>
            <Download /> {role === "creator" ? "Earnings receipt" : "Payment receipt"} (PDF)
          </a>
        )}
        {project.certificate_id && (
          <>
            <a href={certificatePdfUrl(project.certificate_id)} className={buttonVariants({ variant: "secondary", size: "sm" })}><Award /> Licence record (PDF)</a>
            <Link href={`/verify/${project.certificate_id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Verify {project.certificate_id}</Link>
          </>
        )}
      </div>
      {role === "brand" && e?.status === "funded" && s !== "approved" && !["rejected", "cancelled"].includes(s) && (
        <p className="text-xs text-ink-3">Funds are held. Approve the final version to release them.</p>
      )}
      {e?.status === "disputed" && <p className="text-xs text-danger">This payment is disputed. The Creatora team resolves disputes; funds stay held until then.</p>}

      {!!payments?.length && (
        <details className="group rounded-2xl bg-card/60 px-3 py-2">
          <summary className="cursor-pointer list-none text-xs font-medium text-ink-2">Escrow ledger ({payments.length}) <span className="group-open:hidden">▾</span><span className="hidden group-open:inline">▴</span></summary>
          <ol className="mt-2 space-y-1.5 text-xs">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 border-t border-line pt-1.5">
                <span className="font-medium capitalize">{p.event.replace("_", " ")}{p.note && <span className="font-normal text-ink-3"> · {p.note}</span>}</span>
                <span className="tabular-nums text-ink-2">{formatMoney(p.amount, p.currency)} · {formatDateTime(p.created_at)}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] text-ink-3">Append-only ledger: entries can&apos;t be edited or deleted.</p>
        </details>
      )}

      <Dialog open={dialog === "fund"} onOpenChange={(o) => setDialog(o ? "fund" : null)} title="Fund escrow (test mode)" size="sm"
        description="Moves the agreed fee into escrow in Creatora's internal test ledger. No card is charged and no real money moves.">
        {e && (
          <div className="space-y-4">
            <p className="rounded-2xl bg-ink/[0.04] px-4 py-3 text-sm">
              {formatMoney(e.amount, e.currency)} + {formatMoney(e.platform_fee, e.currency)} fee = <b>{formatMoney(e.amount + e.platform_fee, e.currency)}</b>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="primary" loading={busy === "fund"} onClick={async () => {
                await run("fund", () => fundEscrow(db, project.id), "Escrow funded (test mode)");
                setDialog(null);
              }}><Lock /> Fund escrow</Button>
            </div>
          </div>
        )}
      </Dialog>
      <ReasonDialog open={dialog === "refund"} onOpenChange={(o) => setDialog(o ? "refund" : null)} title="Refund escrow"
        description="Returns the held funds to you (test mode)." cta="Refund" danger
        onSubmit={async (reason) => { await refundEscrow(db, project.id, reason); toast.success("Escrow refunded"); onChanged(); }} />
      <ReasonDialog open={dialog === "dispute"} onOpenChange={(o) => setDialog(o ? "dispute" : null)} title="Open a payment dispute"
        description="Funds stay held while the Creatora team reviews the project and messages between you." cta="Open dispute" min={10} danger
        onSubmit={async (reason) => { await disputeEscrow(db, project.id, reason); toast.success("Dispute opened"); onChanged(); }} />
    </section>
  );
}
