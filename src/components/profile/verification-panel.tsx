import Link from "next/link";
import { BadgeCheck, Fingerprint, Briefcase, ShieldCheck, Workflow, Wrench } from "lucide-react";
import type { FullProfile } from "@/types/app";
import { VERIFICATION_TYPES } from "@/config/constants";
import { Tooltip } from "@/components/ui/overlay";
import { cn, timeAgo } from "@/lib/utils";

const ICONS = { tool: Wrench, workflow: Workflow, past_work: Briefcase, identity: Fingerprint };

/** Shows what is verified about a creator and how — the trust signals brands rely on. */
export function VerificationPanel({ profile }: { profile: FullProfile }) {
  const approved = profile.verifications.filter((v) => v.status === "approved");
  const pending = profile.verifications.filter((v) => v.status === "pending");
  const types = Object.keys(VERIFICATION_TYPES) as (keyof typeof VERIFICATION_TYPES)[];

  return (
    <section aria-labelledby="trust-h" className="glass rounded-[2rem] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="trust-h" className="display flex items-center gap-2 text-lg">
          <ShieldCheck className="size-5 text-amber-2" /> Trust & verification
        </h2>
        {profile.is_verified && (
          <span className="flex items-center gap-1 rounded-full bg-amber px-2.5 py-1 text-xs font-semibold text-on-amber">
            <BadgeCheck className="size-3.5" /> Verified creator
          </span>
        )}
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2">
        {types.map((t) => {
          const Icon = ICONS[t];
          const count = approved.filter((v) => v.type === t).length;
          return (
            <Tooltip key={t} side="top" content={`${VERIFICATION_TYPES[t].label}: ${VERIFICATION_TYPES[t].how}`}>
              <div
                tabIndex={0}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-2xl px-1 py-2.5 text-center",
                  count ? "bg-amber-soft text-ink" : "bg-ink/[0.04] text-ink-3",
                )}
              >
                <Icon className="size-4" />
                <span className="text-[10px] font-medium leading-tight">{VERIFICATION_TYPES[t].label.replace(" verified", "").replace(" documented", "")}</span>
                <span className="text-[10px] tabular-nums">{count ? `✓ ${count}` : "—"}</span>
              </div>
            </Tooltip>
          );
        })}
      </div>

      {approved.length === 0 ? (
        <p className="text-sm text-ink-2">
          No verified signals yet.{" "}
          {profile.is_me && <Link href="/verification" className="font-semibold underline-offset-4 hover:underline">Request verification</Link>}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {approved.map((v) => (
            <li key={v.id} className="flex gap-3 text-sm">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 fill-amber text-on-amber" />
              <div className="min-w-0">
                <p className="font-medium">{v.title}</p>
                <p className="text-xs text-ink-3">
                  {VERIFICATION_TYPES[v.type].how}
                  {v.reviewed_at && ` · reviewed ${timeAgo(v.reviewed_at)}`}
                  {v.evidence_url && (
                    <> · <a href={v.evidence_url} target="_blank" rel="noopener noreferrer" className="underline">evidence</a></>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {profile.is_me && pending.length > 0 && (
        <p className="mt-3 text-xs text-ink-3">{pending.length} request{pending.length > 1 ? "s" : ""} awaiting review · <Link href="/verification" className="underline">manage</Link></p>
      )}
    </section>
  );
}
