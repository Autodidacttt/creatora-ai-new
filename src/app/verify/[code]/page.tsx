import Link from "next/link";
import { BadgeCheck, FileWarning, Fingerprint } from "lucide-react";
import { getServerClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/layout/top-bar";
import { EXCLUSIVITY, LICENSE_TYPES, USAGE_DURATIONS, labelOf } from "@/config/constants";

export const metadata = { title: "Verify a licence record · Creatora AI" };

interface Verified {
  certificate_id: string;
  generated_at: string;
  campaign_title: string;
  brand: string;
  creator: string;
  license_type: string;
  territory: string;
  usage_duration: string;
  exclusivity: string;
  asset_count: number;
  asset_sha256: string[];
}

/** Public: anyone with a certificate ID can check it exists and see its minimal, non-sensitive terms. */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = decodeURIComponent(code).toUpperCase().slice(0, 20);
  const db = await getServerClient();
  const { data } = /^CRT-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(clean)
    ? await db.rpc("verify_certificate", { p_code: clean })
    : { data: null };
  const v = data as unknown as Verified | null;

  return (
    <div className="flex min-h-dvh flex-col px-4 py-6">
      <Link href="/" className="mx-auto mb-8 rounded-full sm:mx-0 sm:ml-4" aria-label="Creatora home"><Wordmark /></Link>
      <main className="mx-auto w-full max-w-xl">
        {v ? (
          <section className="glass space-y-5 rounded-[2rem] p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-success/10 text-success"><BadgeCheck className="size-6" /></span>
              <div>
                <p className="eyebrow">Licence record verified</p>
                <h1 className="display text-2xl">{v.certificate_id}</h1>
                <p className="text-sm text-ink-2">Issued {new Date(v.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
              </div>
            </div>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">Campaign</dt><dd>{v.campaign_title}</dd>
              <dt className="text-ink-3">Licensee</dt><dd>{v.brand}</dd>
              <dt className="text-ink-3">Licensor</dt><dd>{v.creator}</dd>
              <dt className="text-ink-3">Licence</dt><dd>{labelOf(LICENSE_TYPES, v.license_type)}</dd>
              <dt className="text-ink-3">Territory</dt><dd>{v.territory}</dd>
              <dt className="text-ink-3">Duration</dt><dd>{labelOf(USAGE_DURATIONS, v.usage_duration)}</dd>
              <dt className="text-ink-3">Exclusivity</dt><dd>{labelOf(EXCLUSIVITY, v.exclusivity)}</dd>
            </dl>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Fingerprint className="size-3.5" /> {v.asset_count} licensed asset{v.asset_count === 1 ? "" : "s"} · SHA-256</p>
              <ul className="space-y-1">
                {v.asset_sha256.map((h) => <li key={h} className="break-all rounded-xl bg-card/70 px-3 py-1.5 font-mono text-[11px] text-ink-2">{h}</li>)}
              </ul>
              <p className="mt-2 text-[11px] text-ink-3">Hash a file with SHA-256 and compare it to the list to confirm it&apos;s one of the licensed assets.</p>
            </div>
            <p className="border-t border-line pt-4 text-xs text-ink-3">
              Platform-generated licence record, not legal advice. Payments on Creatora run in an internal test-mode ledger; no real money moved.
            </p>
          </section>
        ) : (
          <section className="glass space-y-3 rounded-[2rem] p-8 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-danger/10 text-danger"><FileWarning className="size-6" /></span>
            <h1 className="display text-2xl">No record found</h1>
            <p className="text-sm text-ink-2">There&apos;s no licence record with the ID <span className="font-mono">{clean || "—"}</span>. Check the ID on the PDF (it looks like CRT-XXXX-XXXX-XXXX).</p>
          </section>
        )}
      </main>
    </div>
  );
}
