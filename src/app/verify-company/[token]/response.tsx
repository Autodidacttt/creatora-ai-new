"use client";

import { useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";

/** Approve / Reject + optional comment; processed only on the server with the secret key. */
export function InvitationResponse({ token }: { token: string }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(decision: "approved" | "rejected") {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/verify-company/${token}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, comment }),
      });
      const json = (await res.json().catch(() => ({}))) as { result?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Couldn't record your answer.");
      setDone(json.result ?? decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record your answer.");
    } finally {
      setBusy(null);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-2xl bg-card/70 p-4 text-sm">
        {done === "approved" ? <><CheckCircle2 className="mr-1.5 inline size-4 text-success" /> Thank you — you confirmed this person represents your company.</>
          : done === "rejected" ? <><XCircle className="mr-1.5 inline size-4 text-danger" /> Thank you — you told us this person is not authorized. Our team will review the account.</>
          : done === "expired" ? "This link has expired; no decision was recorded."
          : "A response was already recorded for this link."}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Field label="Comment" htmlFor="comment" optional>
        <Textarea id="comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything our team should know" />
      </Field>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={busy === "approved"} disabled={!!busy} onClick={() => respond("approved")}><CheckCircle2 /> Approve</Button>
        <Button variant="danger" loading={busy === "rejected"} disabled={!!busy} onClick={() => respond("rejected")}><XCircle /> Reject</Button>
      </div>
    </div>
  );
}
