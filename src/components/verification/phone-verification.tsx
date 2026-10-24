"use client";

import { useEffect, useState } from "react";
import { CircleCheck, FlaskConical, Phone } from "lucide-react";
import { toast } from "sonner";
import { checkPhoneCode, startPhoneVerification, type MyVerification } from "@/services/verification";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

type Challenge = { challenge_id: string; masked: string; demo_code?: string; demo_label?: string };

/** Phone OTP: one verified number per Creatora account. In demo mode the code is shown here (no SMS is sent). */
export function PhoneVerification({ status, onVerified }: { status: MyVerification; onVerified: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<"send" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (status.phone) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <CircleCheck className="size-4 text-success" /> <strong>Phone Verified</strong> · {status.phone.masked}
        <span className="text-ink-3">({status.phone.method === "demo" ? "demo OTP" : "SMS"})</span>
      </p>
    );
  }

  async function send() {
    setBusy("send"); setError(null);
    try {
      const c = await startPhoneVerification(phone);
      setChallenge(c); setCode(""); setCooldown(c.resend_in);
      toast.success(c.demo_code ? "Demo code generated" : `Code sent to ${c.masked}`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }
  async function check() {
    if (!challenge) return;
    setBusy("check"); setError(null);
    try {
      await checkPhoneCode(challenge.challenge_id, code);
      toast.success("Phone verified");
      onVerified();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Mobile number" htmlFor="phone" hint="Include the country code, e.g. +91 98765 43210" className="min-w-56 flex-1">
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
        </Field>
        <Button variant={challenge ? "secondary" : "primary"} loading={busy === "send"} disabled={!phone.trim() || cooldown > 0} onClick={send}>
          <Phone /> {challenge ? (cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code") : "Send code"}
        </Button>
      </div>
      {challenge && (
        <>
          {challenge.demo_code && (
            <p className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-amber bg-amber-soft/60 px-3 py-2 text-sm" role="status">
              <FlaskConical className="size-4" /> <strong>{challenge.demo_label}</strong> — your code is
              <code className="rounded-lg bg-card px-2 py-0.5 font-mono text-base tracking-widest">{challenge.demo_code}</code>
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <Field label={`Code sent to ${challenge.masked}`} htmlFor="otp" hint="6 digits · expires in 5 minutes · 5 attempts" className="min-w-40">
              <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" className="font-mono tracking-widest" />
            </Field>
            <Button variant="primary" loading={busy === "check"} disabled={code.length !== 6} onClick={check}><CircleCheck /> Verify</Button>
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
