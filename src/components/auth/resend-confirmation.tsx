"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";
import { getBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

/** Re-sends the signup confirmation email to the current site's callback. */
export function ResendConfirmation({ defaultEmail = "", compact }: { defaultEmail?: string; compact?: boolean }) {
  const [email, setEmail] = useState(defaultEmail);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email you signed up with");
    setError(null);
    setState("sending");
    const { error } = await getBrowserClient().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });
    if (error) {
      setState("idle");
      setError(error.status === 429 ? "Too many emails sent — wait a minute and try again." : error.message);
      return;
    }
    setState("sent");
    toast.success("Confirmation email sent");
  }

  if (state === "sent") {
    return (
      <p className="flex items-center gap-2 text-sm"><MailCheck className="size-4" /> New link sent to <strong>{email.trim()}</strong>. Open it in this browser.</p>
    );
  }
  return (
    <div className="space-y-2">
      <div className={compact ? "flex gap-2" : "flex flex-col gap-2 sm:flex-row"}>
        {!compact && (
          <Input type="email" autoComplete="email" placeholder="you@example.com" aria-label="Email for confirmation link"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
        <Button onClick={send} loading={state === "sending"} variant="dark">Resend confirmation email</Button>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
