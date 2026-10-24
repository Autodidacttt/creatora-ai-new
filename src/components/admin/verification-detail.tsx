"use client";

import { useState } from "react";
import { BadgeCheck, Eye, X } from "lucide-react";
import { toast } from "sonner";
import { revealPhone, type AuditEntry } from "@/services/verification";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { errorMessage, timeAgo } from "@/lib/utils";
import { StatusChip } from "./verification-status";

/** Mark Verified / Reject (a reason is required to reject). The database checks the admin's permission. */
export function DecisionBar({ onDecide }: { onDecide: (decision: "verified" | "rejected", reason?: string) => Promise<void> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"verified" | "rejected" | null>(null);
  const decide = async (d: "verified" | "rejected") => {
    setBusy(d);
    try { await onDecide(d, d === "rejected" ? reason : undefined); setRejecting(false); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy === "verified"} onClick={() => decide("verified")}><BadgeCheck /> Mark Verified</Button>
        <Button variant="danger" onClick={() => setRejecting(true)}><X /> Reject</Button>
      </div>
      <Dialog open={rejecting} onOpenChange={setRejecting} title="Reject this verification?" description="The applicant sees this reason." size="sm">
        <div className="space-y-3">
          <Field label="Reason" htmlFor="reject-reason" hint="At least 5 characters">
            <Textarea id="reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button variant="danger" loading={busy === "rejected"} disabled={reason.trim().length < 5} onClick={() => decide("rejected")}><X /> Reject</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/** Masked by default; revealing the number is audit-logged on the server. No calling feature. */
export function PhoneField({ kind, id, phone }: { kind: "identity" | "company"; id: string; phone: { masked: string; method: string; verified_at: string; same_number: boolean } | null }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!phone) return <span className="text-danger">Not verified</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{full ?? phone.masked}</span>
      <span className="text-xs text-ink-3">· Phone Verified via {phone.method === "demo" ? "demo OTP" : "SMS"} {timeAgo(phone.verified_at)}{phone.same_number ? "" : " · number changed since submission"}</span>
      {!full && (
        <Button size="sm" variant="ghost" loading={busy} onClick={async () => {
          setBusy(true);
          try { setFull((await revealPhone(kind, id)).phone); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
        }}><Eye /> Show number</Button>
      )}
    </span>
  );
}

export function HistoryList({ items }: { items: { id: string; status: string; created_at: string; reason: string | null }[] }) {
  if (!items.length) return <p className="text-sm text-ink-3">No earlier submissions.</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center gap-2 text-sm">
          <StatusChip status={h.status} /> <span className="text-ink-3">{timeAgo(h.created_at)}</span>{h.reason && <span className="text-ink-2">— {h.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

export function AuditList({ items }: { items: AuditEntry[] }) {
  if (!items.length) return <p className="text-sm text-ink-3">No actions yet.</p>;
  return (
    <ol className="space-y-1 text-xs text-ink-2">
      {items.map((l, i) => (
        <li key={i}><span className="font-mono">{l.action.replaceAll("_", " ")}</span> · {l.actor?.display_name ?? "system / company contact"} · {timeAgo(l.at)}</li>
      ))}
    </ol>
  );
}
