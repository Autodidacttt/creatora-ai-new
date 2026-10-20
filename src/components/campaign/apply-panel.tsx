"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Check, EyeOff, FolderKanban, Send, Star, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { CampaignCard } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { apply, ignoreOpportunity, setApplicationStatus, setSavedOpportunity } from "@/services/campaigns";
import { scoreCreators } from "@/services/discovery";
import { applicationSchema } from "@/lib/validation/schemas";
import { Dialog } from "@/components/ui/overlay";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { Countdown } from "@/components/workspace/countdown";
import { PillCTA } from "@/components/ui/pill-cta";
import { Chip } from "@/components/ui/chip";
import { GlassPanel } from "@/components/ui/glass";
import { Skeleton } from "@/components/ui/states";
import { ContactButton } from "@/components/posts/actions";
import { errorMessage } from "@/lib/utils";
import { ScoreBreakdown, ScoreRing } from "./score-breakdown";

/** Creator-side panel on a brief: relevance, save, apply with a pitch, withdraw, ignore. */
export function ApplyPanel({ campaign, onChange }: { campaign: CampaignCard; onChange: () => void }) {
  const db = useDb();
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pitch, setPitch] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(campaign.saved);
  const match = useQuery({
    queryKey: ["my-match", campaign.id],
    queryFn: async () => (await scoreCreators(db, campaign.id, [me.id])).get(me.id) ?? null,
  });
  const app = campaign.my_application;
  const canApply = campaign.status === "active" && !campaign.sprint_closed;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["opportunities"] }); onChange(); };

  async function submit() {
    const parsed = applicationSchema.safeParse({ pitch, proposed_rate: rate.trim() ? rate : null });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check your pitch");
    setError(null);
    setBusy("apply");
    try {
      await apply(db, campaign.id, parsed.data.pitch, parsed.data.proposed_rate ?? null);
      toast.success("Application sent — the brand has been notified");
      setOpen(false);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function act(key: string, fn: () => Promise<void>, ok: string) {
    setBusy(key);
    try { await fn(); toast.success(ok); refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <GlassPanel className="space-y-4 p-5">
      <div className="flex items-center gap-4">
        {match.isPending ? <Skeleton className="size-16 rounded-full" /> : match.data ? <ScoreRing score={match.data.score} /> : null}
        <div>
          <p className="display text-lg">Your relevance</p>
          <p className="text-xs text-ink-3">How your profile matches this brief&apos;s requirements</p>
        </div>
      </div>
      {match.data && (
        <>
          {match.data.reasons.length > 0 && (
            <ul className="space-y-1 text-sm">{match.data.reasons.map((r) => <li key={r}>✦ {r}</li>)}</ul>
          )}
          <details className="rounded-2xl bg-card px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-2">See breakdown</summary>
            <div className="mt-2"><ScoreBreakdown breakdown={match.data.breakdown} /></div>
          </details>
        </>
      )}

      {campaign.is_sprint && campaign.sprint_deadline && (
        <div className="space-y-1.5 rounded-2xl bg-amber-soft/70 p-3 text-xs">
          <div className="flex items-center justify-between gap-2"><strong className="text-sm">48-hour sprint</strong><Countdown to={campaign.sprint_deadline} /></div>
          <p className="text-ink-2">Apply, then submit spec work from your project page before the deadline. Late submissions are rejected automatically.</p>
        </div>
      )}
      {campaign.my_project && (
        <Link href={`/opportunities/projects/${campaign.my_project.id}`} className={buttonVariants({ variant: "dark", className: "w-full" })}>
          <FolderKanban /> Open my project
        </Link>
      )}

      <div className="space-y-2 border-t border-line pt-4">
        {campaign.my_selected && <Chip tone="dark" icon={<Check />}>You&apos;re hired for this brief</Chip>}
        {campaign.my_shortlisted && !campaign.my_selected && <Chip tone="amber" icon={<Star />}>You&apos;re shortlisted</Chip>}
        {app && (
          <p className="text-sm">
            Application status: <strong className="capitalize">{app.status === "pending" ? "Sent · awaiting review" : app.status}</strong>
          </p>
        )}
        {!app || app.status === "withdrawn" ? (
          <PillCTA className="w-full" onClick={() => setOpen(true)} disabled={!canApply}>{canApply ? "Apply with a pitch" : "Not accepting applications"}</PillCTA>
        ) : app.status === "pending" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setPitch(""); setOpen(true); }}><Send /> Update pitch</Button>
            <Button size="sm" variant="ghost" loading={busy === "withdraw"} onClick={() => act("withdraw", () => setApplicationStatus(db, app.id, "withdrawn"), "Application withdrawn")}>
              <Undo2 /> Withdraw
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy === "save"} onClick={() => act("save", async () => { await setSavedOpportunity(db, campaign.id, !saved); setSaved(!saved); }, saved ? "Removed from saved" : "Saved for later")}>
            {saved ? <BookmarkCheck /> : <Bookmark />} {saved ? "Saved" : "Save"}
          </Button>
          <ContactButton profileId={campaign.brand.id} size="sm" label="Ask the brand" />
          {!app && (
            <Button size="sm" variant="ghost" loading={busy === "ignore"} onClick={() => act("ignore", async () => { await ignoreOpportunity(db, campaign.id); router.push("/opportunities"); }, "Hidden from your opportunities")}>
              <EyeOff /> Not for me
            </Button>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen} title={`Apply to “${campaign.title}”`} description="Brands read pitches alongside your relevance score and portfolio.">
        <div className="space-y-4">
          <Field label="Your pitch" htmlFor="pitch" error={error} hint="Which portfolio pieces are closest? How would you approach it? Which tools?">
            <Textarea id="pitch" rows={6} maxLength={1500} value={pitch} onChange={(e) => setPitch(e.target.value)}
              placeholder="I'd approach this by…" />
          </Field>
          <Field label={`Proposed fee (${campaign.currency})`} htmlFor="rate" optional>
            <Input id="rate" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <PillCTA onClick={submit} loading={busy === "apply"}>Send application</PillCTA>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
