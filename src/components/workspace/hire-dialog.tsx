"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { toast } from "sonner";
import { CURRENCIES } from "@/config/constants";
import { useDb } from "@/features/session";
import { hireCreator } from "@/services/workspace";
import { hireSchema } from "@/lib/validation/workspace";
import { Dialog } from "@/components/ui/overlay";
import { Field, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";
import { formatMoney } from "@/lib/money";

/** Hiring sets the agreed amount and opens an (unfunded, test-mode) escrow. */
export function HireDialog({ open, onOpenChange, campaignId, creator, suggestedAmount, currency, onHired }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  campaignId: string;
  creator: { id: string; display_name: string };
  suggestedAmount: number | null;
  currency: string;
  onHired?: (projectId: string) => void;
}) {
  const db = useDb();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(suggestedAmount ? String(suggestedAmount) : "");
  const [cur, setCur] = useState((CURRENCIES as readonly string[]).includes(currency) ? currency : "USD");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fee = Math.ceil((Number(amount) || 0) * 0.08);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = hireSchema.safeParse({ amount, currency: cur });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the amount");
    setBusy(true);
    setError(null);
    try {
      const projectId = await hireCreator(db, campaignId, creator.id, parsed.data.amount, parsed.data.currency);
      toast.success(`${creator.display_name} hired — escrow opened (test mode)`);
      ["pipeline", "matches", "applications", "campaign", "hiring", "deliveries", "brand-overview"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
      onHired?.(projectId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Hire ${creator.display_name}`} size="sm"
      description="Agree the fee. It's held in escrow once you fund it and released when you approve the final work.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Agreed amount" htmlFor="hire-amount" error={error}>
            <Input id="hire-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 2500" autoFocus />
          </Field>
          <Field label="Currency" htmlFor="hire-cur">
            <Select id="hire-cur" value={cur} onChange={(e) => setCur(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </Field>
        </div>
        {Number(amount) > 0 && (
          <p className="rounded-2xl bg-ink/[0.04] px-4 py-3 text-xs text-ink-2">
            Creator receives <b className="text-ink">{formatMoney(Number(amount), cur)}</b>. Platform fee {formatMoney(fee, cur)} (8%) is charged to you on top —
            <b className="text-ink"> {formatMoney(Number(amount) + fee, cur)}</b> in total when you fund escrow.
          </p>
        )}
        <p className="text-[11px] text-ink-3">Test mode: escrow is an internal ledger. No real money moves.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}><UserCheck /> Hire & open escrow</Button>
        </div>
      </form>
    </Dialog>
  );
}
