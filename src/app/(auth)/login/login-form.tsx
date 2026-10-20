"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { getBrowserClient } from "@/lib/supabase/client";
import { signInSchema } from "@/lib/validation/schemas";
import { GlassPanel } from "@/components/ui/glass";
import { Field, Input } from "@/components/ui/field";
import { PillCTA } from "@/components/ui/pill-cta";
import { DEMO_LOGINS, DEMO_PASSWORD } from "@/config/demo";
import { AUTH_LINK_MESSAGES, safeNext, type AuthLinkError } from "@/lib/auth-links";
import { ResendConfirmation } from "@/components/auth/resend-confirmation";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const linkError = params.get("error");
  // "confirm" is the legacy reason code used before the callback reported specific reasons
  const linkMessage = linkError ? AUTH_LINK_MESSAGES[(linkError === "confirm" ? "invalid" : linkError) as AuthLinkError] ?? AUTH_LINK_MESSAGES.invalid : null;
  const [unconfirmed, setUnconfirmed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    const { error } = await getBrowserClient().auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (error) {
      if (error.code === "email_not_confirmed") {
        setUnconfirmed(true);
        setErrors({ form: "Please confirm your email first — check your inbox for the link, or resend it below." });
        return;
      }
      setErrors({ form: error.message === "Invalid login credentials" ? "Email or password is incorrect." : error.message });
      return;
    }
    toast.success("Welcome back");
    router.replace(safeNext(params.get("next")));
    router.refresh();
  }

  return (
    <div className="w-full space-y-4">
      <GlassPanel className="p-6 sm:p-8">
        <h1 className="display text-3xl">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-2">Sign in to your creator or brand account.</p>
        {linkMessage && (
          <div role="alert" className={"mt-4 space-y-2 rounded-2xl px-4 py-3 text-sm " + (linkError === "other_browser" ? "bg-success/10" : "bg-amber-soft")}>
            <p className="font-semibold">{linkMessage.title}</p>
            <p className="text-ink-2">{linkMessage.body}</p>
            {linkMessage.offerResend && <ResendConfirmation />}
          </div>
        )}
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password}>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {errors.form && <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{errors.form}</p>}
          {unconfirmed && <ResendConfirmation key={email} defaultEmail={email} compact />}
          <PillCTA type="submit" loading={loading} className="w-full">Sign in</PillCTA>
        </form>
        <p className="mt-6 text-center text-sm text-ink-2">
          New to Creatora? <Link href="/signup" className="font-semibold text-ink underline-offset-4 hover:underline">Create an account</Link>
        </p>
      </GlassPanel>

      <GlassPanel className="p-5">
        <p className="eyebrow">Demo accounts</p>
        <p className="mt-1 text-xs text-ink-2">Password for all: <code className="rounded bg-ink/5 px-1.5 py-0.5">{DEMO_PASSWORD}</code></p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO_LOGINS.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => { setEmail(d.email); setPassword(DEMO_PASSWORD); }}
              className="rounded-full border border-line bg-card px-3 py-1.5 text-left text-xs transition-colors hover:border-amber"
            >
              <span className="font-semibold">{d.role}</span> · {d.hint}
            </button>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
