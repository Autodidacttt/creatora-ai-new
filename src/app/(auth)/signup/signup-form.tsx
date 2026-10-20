"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, MailCheck, Sparkles } from "lucide-react";
import { getBrowserClient } from "@/lib/supabase/client";
import { signUpSchema } from "@/lib/validation/schemas";
import { GlassPanel } from "@/components/ui/glass";
import { Field, Input } from "@/components/ui/field";
import { PillCTA } from "@/components/ui/pill-cta";
import { cn } from "@/lib/utils";
import { ResendConfirmation } from "@/components/auth/resend-confirmation";

const ROLES = [
  { value: "creator", title: "I'm a creator", body: "Showcase AI work, tools and workflows. Get discovered by brands.", icon: Sparkles },
  { value: "brand", title: "I'm a brand or agency", body: "Post briefs, discover creators and hire with confidence.", icon: Building2 },
] as const;

export function SignupForm() {
  const router = useRouter();
  const [role, setRole] = useState<"creator" | "brand">("creator");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = signUpSchema.safeParse({ role, displayName, email, password });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setLoading(true);
    const { data, error } = await getBrowserClient().auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        // The DB trigger creates an empty profile with this role (admin can never be self-assigned)
        data: { role: parsed.data.role, display_name: parsed.data.displayName },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setLoading(false);
    if (error) {
      setErrors({ form: error.message });
      return;
    }
    if (data.session) {
      router.replace("/onboarding");
      router.refresh();
    } else {
      setSentTo(parsed.data.email);
    }
  }

  if (sentTo) {
    return (
      <GlassPanel className="w-full p-8 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-amber-soft"><MailCheck className="size-6" /></div>
        <h1 className="display mt-4 text-2xl">Check your inbox</h1>
        <p className="mt-2 text-sm text-ink-2">
          We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish setting up your account.
        </p>
        <p className="mt-2 text-xs text-ink-3">Open the link in this same browser. Didn&apos;t get it? Check spam, or:</p>
        <div className="mt-3 flex justify-center"><ResendConfirmation defaultEmail={sentTo} compact /></div>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold underline-offset-4 hover:underline">Back to sign in</Link>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="w-full p-6 sm:p-8">
      <h1 className="display text-3xl">Join Creatora</h1>
      <p className="mt-1 text-sm text-ink-2">Your account starts empty — you build it.</p>

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">I&apos;m joining as</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ROLES.map((r) => {
              const Icon = r.icon;
              const active = role === r.value;
              return (
                <label
                  key={r.value}
                  className={cn(
                    "cursor-pointer rounded-3xl border-2 p-4 transition-all",
                    active ? "border-amber bg-amber-soft" : "border-line bg-card hover:border-ink/20",
                  )}
                >
                  <input type="radio" name="role" value={r.value} checked={active} onChange={() => setRole(r.value)} className="sr-only" />
                  <Icon className="mb-2 size-5" />
                  <span className="block text-sm font-semibold">{r.title}</span>
                  <span className="mt-1 block text-xs text-ink-2">{r.body}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <Field label={role === "brand" ? "Brand or agency name" : "Your name"} htmlFor="name" error={errors.displayName}>
          <Input id="name" autoComplete={role === "brand" ? "organization" : "name"} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password} hint="At least 8 characters">
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {errors.form && <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{errors.form}</p>}
        <PillCTA type="submit" loading={loading} className="w-full">Create account</PillCTA>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        Already have an account? <Link href="/login" className="font-semibold text-ink underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </GlassPanel>
  );
}
