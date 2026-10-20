"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Rocket, Star, StarOff, Users } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { rankForCampaign } from "@/services/discovery";
import { getCampaign, getPipeline, setShortlisted } from "@/services/campaigns";
import { inviteCreator, publishCampaign } from "@/services/workspace";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InfiniteSentinel } from "@/components/ui/misc";
import { ScoreBreakdown, ScoreRing } from "@/components/campaign/score-breakdown";
import { errorMessage } from "@/lib/utils";

/** Step 4: rank creators against the saved brief, shortlist / invite, and publish. */
export function StepCreators({ campaignId, canPublish, publishProblem }: { campaignId: string; canPublish: boolean; publishProblem: string | null }) {
  const db = useDb();
  const qc = useQueryClient();
  const campaign = useQuery({ queryKey: ["campaign", campaignId], queryFn: () => getCampaign(db, campaignId) });
  const pipeline = useQuery({ queryKey: ["pipeline", campaignId], queryFn: () => getPipeline(db, campaignId) });
  const q = useInfiniteQuery({
    queryKey: ["matches", campaignId, "studio"],
    queryFn: ({ pageParam }) => rankForCampaign(db, campaignId, pageParam, 8),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [invited, setInvited] = useState<string[]>([]);
  const live = campaign.data?.status === "active";
  const shortlisted = new Set(pipeline.data?.filter((p) => p.stage === "shortlisted").map((p) => p.creator.id));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };

  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="space-y-4">
      <div className="glass flex flex-wrap items-center gap-3 rounded-[1.75rem] p-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{live ? "Published — creators can apply" : "Ready to publish?"}</p>
          <p className="text-xs text-ink-2">{live ? "Invite your top matches so they see it first." : publishProblem ?? "Publishing makes the brief visible in Opportunities and notifies the best-matching creators."}</p>
        </div>
        {live ? (
          <Link href={`/campaigns/${campaignId}`} className={buttonVariants({ variant: "dark" })}>Open campaign</Link>
        ) : (
          <Button variant="primary" disabled={!canPublish} loading={busy === "publish"} onClick={() => run("publish", async () => {
            const n = await publishCampaign(db, campaignId);
            toast.success(n ? `Published — ${n} matching creator${n === 1 ? "" : "s"} notified` : "Published");
            qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
            qc.invalidateQueries({ queryKey: ["campaigns"] });
            qc.invalidateQueries({ queryKey: ["brand-overview"] });
          })}><Rocket /> Publish</Button>
        )}
      </div>

      <p className="text-xs text-ink-2">Ranked by relevance to this brief — a transparent score of tools, portfolio, skills, experience, platform fit and availability. It&apos;s a matching signal, not a measure of talent.</p>
      {q.isPending && <div className="grid gap-3 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-[1.75rem]" />)}</div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState icon={<Users />} title="No matches yet" description="Add tools, formats and a content type to the brief to sharpen matching." />}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((m) => {
          const on = shortlisted.has(m.creator.id);
          return (
            <article key={m.creator.id} className="glass space-y-3 rounded-[1.75rem] p-4">
              <div className="flex items-center gap-3">
                <Link href={`/u/${m.creator.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar src={m.creator.avatar_url} name={m.creator.display_name} size="md" verified={m.creator.is_verified} />
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold">{m.creator.display_name}</span><span className="block truncate text-xs text-ink-2">{m.creator.headline}</span></span>
                </Link>
                <ScoreRing score={m.score} size={52} />
              </div>
              <details className="group rounded-2xl bg-card/70 px-3 py-2" open={m.reasons.length > 0}>
                <summary className="cursor-pointer list-none text-xs font-semibold text-ink-2">Why this creator? ▾</summary>
                {m.reasons.length > 0 && <ul className="mt-1.5 space-y-0.5 text-xs">{m.reasons.slice(0, 4).map((r) => <li key={r}>✦ {r}</li>)}</ul>}
                <div className="mt-2"><ScoreBreakdown breakdown={m.breakdown} /></div>
              </details>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant={on ? "secondary" : "primary"} loading={busy === `s${m.creator.id}`} onClick={() => run(`s${m.creator.id}`, async () => {
                  await setShortlisted(db, campaignId, m.creator.id, !on);
                  await pipeline.refetch();
                  toast.success(on ? "Removed from shortlist" : `${m.creator.display_name} shortlisted`);
                })}>{on ? <StarOff /> : <Star />} {on ? "Shortlisted" : "Shortlist"}</Button>
                <Button size="sm" variant="secondary" disabled={!live || invited.includes(m.creator.id)} loading={busy === `i${m.creator.id}`}
                  title={live ? undefined : "Publish first to invite"}
                  onClick={() => run(`i${m.creator.id}`, async () => {
                    const sent = await inviteCreator(db, campaignId, m.creator.id);
                    setInvited((x) => [...x, m.creator.id]);
                    toast.success(sent ? `Invitation sent to ${m.creator.display_name}` : "Already invited");
                  })}>
                  <Mail /> {invited.includes(m.creator.id) ? "Invited" : "Invite"}
                </Button>
                {m.creator.tools.slice(0, 2).map((t) => <Chip key={t.id} tone="outline">{t.name}</Chip>)}
              </div>
            </article>
          );
        })}
      </div>
      {q.hasNextPage && <InfiniteSentinel onVisible={() => !q.isFetchingNextPage && q.fetchNextPage()} loading={q.isFetchingNextPage} />}
    </div>
  );
}
