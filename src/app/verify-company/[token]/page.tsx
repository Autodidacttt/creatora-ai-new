import Link from "next/link";
import { Building2, Clock, ShieldQuestion } from "lucide-react";
import { getAdminClient } from "@/lib/supabase/admin";
import { pepperedHash } from "@/lib/verification/crypto";
import { Wordmark } from "@/components/layout/top-bar";
import { InvitationResponse } from "./response";

export const metadata = { title: "Confirm a company representative · Creatora AI", robots: { index: false } };
export const dynamic = "force-dynamic";

interface Lookup { status: string; company_name: string; website_domain: string; applicant_name: string; applicant_role: string; expires_at: string }

/** Public, no login: the company contact confirms (or rejects) that the applicant may represent the company. */
export default async function VerifyCompanyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{30,60}$/.test(token);
  const { data } = valid ? await getAdminClient().rpc("company_invitation_lookup", { p_token_hash: pepperedHash("invite", token) }) : { data: null };
  const inv = data as Lookup | null;

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <Link href="/" className="mx-auto mb-8 rounded-full sm:mx-0 sm:ml-4" aria-label="Creatora home"><Wordmark /></Link>
      <main className="mx-auto w-full max-w-xl">
        {!inv ? (
          <Notice icon={<ShieldQuestion className="size-6" />} title="This link isn't valid" body="Check that you opened the full link from the email. If you weren't expecting it, you can ignore it." />
        ) : inv.status === "expired" ? (
          <Notice icon={<Clock className="size-6" />} title="This link has expired" body="No decision was recorded. The Creatora team can send a new link if needed." />
        ) : inv.status !== "sent" ? (
          <Notice icon={<ShieldQuestion className="size-6" />} title="This link was already used" body={`A response was recorded (${inv.status === "approved" ? "approved" : inv.status === "rejected" ? "rejected" : "closed"}). Each link works once.`} />
        ) : (
          <section className="glass space-y-5 rounded-[2rem] p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-soft text-ink"><Building2 className="size-6" /></span>
              <div>
                <p className="eyebrow">Company verification</p>
                <h1 className="display text-2xl">Is this person authorized to represent your company?</h1>
                <p className="mt-1 text-sm text-ink-2">Someone is trying to represent your company on Creatora, a marketplace for AI creative work.</p>
              </div>
            </div>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">Company</dt><dd>{inv.company_name} <span className="text-ink-3">({inv.website_domain})</span></dd>
              <dt className="text-ink-3">Applicant</dt><dd>{inv.applicant_name}</dd>
              <dt className="text-ink-3">Role</dt><dd>{inv.applicant_role}</dd>
              <dt className="text-ink-3">Link expires</dt><dd>{new Date(inv.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</dd>
            </dl>
            <InvitationResponse token={token} />
            <p className="text-[11px] text-ink-3">Your answer is recorded once. If you reject, the Creatora team reviews the account; nothing happens automatically.</p>
          </section>
        )}
      </main>
    </div>
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <section className="glass space-y-3 rounded-[2rem] p-6 text-center sm:p-8">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-card text-ink-2">{icon}</span>
      <h1 className="display text-2xl">{title}</h1>
      <p className="text-sm text-ink-2">{body}</p>
    </section>
  );
}
