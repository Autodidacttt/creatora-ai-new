"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, History, Lightbulb, RotateCw, Sparkles, Star, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { AI_FINDER_EXAMPLES, AI_MATCH, AI_MATCH_WEIGHTS } from "@/config/ai-match";
import { AiExplanationsOff, explainAiMatch, getAiResults, getRecentAiSearches, runAiSearch, setAiResultSaved, type AiMatchBreakdown, type AiMatchResult, type AiSearchMeta } from "@/services/ai-match";
import { getBrandCampaigns, setShortlisted } from "@/services/campaigns";
import { CreatorResultCard } from "@/components/discovery/creator-card";
import { ContactButton } from "@/components/posts/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Select } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { cn, errorMessage } from "@/lib/utils";

const PARTS: { key: keyof typeof AI_MATCH_WEIGHTS & keyof AiMatchBreakdown; label: string }[] = [
  { key: "semantic", label: "Similarity" }, { key: "tools", label: "Tools" }, { key: "skills", label: "Skills" },
  { key: "style", label: "Style" }, { key: "content_type", label: "Content type" }, { key: "specialization", label: "Specialization" },
  { key: "keywords", label: "Keywords" }, { key: "experience", label: "Experience" }, { key: "availability", label: "Availability" },
];

/** Stacked bar: how much each component contributed to the match score (only the components that applied). */
function BreakdownBar({ b }: { b: AiMatchBreakdown }) {
  const parts = PARTS.filter((p) => typeof b[p.key] === "number");
  const totalW = parts.reduce((s, p) => s + AI_MATCH_WEIGHTS[p.key], 0) || 1;
  const segs = parts.map((p) => ({ ...p, value: b[p.key] as number, share: (AI_MATCH_WEIGHTS[p.key] / totalW) * ((b[p.key] as number) / 100) }));
  const top = [...segs].sort((x, y) => y.share - x.share).slice(0, 3);
  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-ink/[0.06]" role="img"
        aria-label={`Score breakdown: ${segs.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        {segs.map((s, i) => (
          <span key={s.key} title={`${s.label}: ${s.value}/100`} style={{ width: `${s.share * 100}%`, opacity: 1 - i * 0.08 }} className="h-full bg-amber" />
        ))}
      </div>
      <p className="text-[11px] text-ink-3">{top.map((s) => `${s.label} ${s.value}`).join(" · ")}</p>
    </div>
  );
}

function WhyThisCreator({ searchId, creatorId }: { searchId: string; creatorId: string }) {
  const [open, setOpen] = useState(false);
  // Generated only on click; cached server-side per (search, creator)
  const q = useQuery({ queryKey: ["ai-reason", searchId, creatorId], queryFn: () => explainAiMatch(searchId, creatorId), enabled: open, staleTime: Infinity, retry: false });
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Lightbulb /> Why this creator?</Button>;
  return (
    <div className="w-full rounded-2xl bg-amber-soft/70 px-3 py-2 text-xs" aria-live="polite">
      <p className="eyebrow mb-1 !text-ink">Why this creator?</p>
      {q.isPending && <div className="space-y-1.5"><Skeleton className="h-3 w-11/12" /><Skeleton className="h-3 w-10/12" /><Skeleton className="h-3 w-9/12" /></div>}
      {q.isError && q.error instanceof AiExplanationsOff && <p className="text-ink-2">{q.error.message}</p>}
      {q.isError && !(q.error instanceof AiExplanationsOff) && (
        <div className="flex items-center gap-2">
          <span className="text-danger">{errorMessage(q.error)}</span>
          <Button size="sm" variant="ghost" onClick={() => q.refetch()}><RotateCw /> Retry</Button>
        </div>
      )}
      {q.data && (
        <>
          <ul className="space-y-0.5">{q.data.reasons.map((r) => <li key={r}>✦ {r}</li>)}</ul>
          {q.data.gaps.length > 0 && <p className="mt-1.5 text-ink-2"><b>Gaps:</b> {q.data.gaps.join(" · ")}</p>}
          <p className="mt-1 text-[10px] text-ink-3">Based only on this creator&apos;s profile, tools and portfolio.</p>
        </>
      )}
    </div>
  );
}

function ResultActions({ r, searchId, briefId, onSaved }: { r: AiMatchResult; searchId: string; briefId: string | null; onSaved: () => void }) {
  const db = useDb();
  const [busy, setBusy] = useState<string | null>(null);
  const [shortlisted, setShortlistedLocal] = useState(false);
  const run = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try { await fn(); toast.success(ok); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-3">
      <BreakdownBar b={r.breakdown} />
      <div className="flex flex-wrap gap-1.5">
        <Link href={`/u/${r.creator.username}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>View profile</Link>
        <ContactButton profileId={r.creator.id} size="sm" label="Message" />
        <Button size="sm" variant="ghost" loading={busy === "save"} aria-pressed={r.saved}
          onClick={() => run("save", async () => { await setAiResultSaved(db, searchId, r.creator.id, !r.saved); onSaved(); }, r.saved ? "Removed from saved" : "Saved to this search")}>
          {r.saved ? <BookmarkCheck /> : <Bookmark />} {r.saved ? "Saved" : "Save"}
        </Button>
        {briefId && (
          <Button size="sm" variant="ghost" loading={busy === "shortlist"} disabled={shortlisted}
            onClick={() => run("shortlist", async () => { await setShortlisted(db, briefId, r.creator.id, true); setShortlistedLocal(true); }, `${r.creator.display_name} shortlisted`)}>
            <Star /> {shortlisted ? "Shortlisted" : "Shortlist"}
          </Button>
        )}
        <WhyThisCreator searchId={searchId} creatorId={r.creator.id} />
      </div>
    </div>
  );
}

/** Brand Explore: describe an idea, get ranked creators (semantic + tags), explain any match on demand. */
export function AiFinder() {
  const db = useDb();
  const qc = useQueryClient();
  const [idea, setIdea] = useState("");
  const [search, setSearch] = useState<AiSearchMeta | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const briefs = useQuery({ queryKey: ["campaigns", "active"], queryFn: () => getBrandCampaigns(db, { status: "active" }) });
  const recent = useQuery({ queryKey: ["ai-searches"], queryFn: () => getRecentAiSearches(db) });
  const results = useInfiniteQuery({
    queryKey: ["ai-results", search?.search_id],
    queryFn: ({ pageParam }) => getAiResults(db, search!.search_id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
    enabled: !!search,
  });
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const tooShort = idea.trim().length < AI_MATCH.ideaMin;

  async function find(text = idea) {
    const t = text.trim();
    if (t.length < AI_MATCH.ideaMin) return setError(`Describe the idea in at least ${AI_MATCH.ideaMin} characters`);
    setIdea(t);
    setRunning(true);
    setError(null);
    setSearch(null);
    try {
      setSearch(await runAiSearch(t));
      qc.invalidateQueries({ queryKey: ["ai-searches"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="glass space-y-4 rounded-[2rem] p-4 sm:p-5" aria-labelledby="ai-finder-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-finder-title" className="display flex items-center gap-2 text-xl"><Wand2 className="size-5 text-amber-2" /> Find with AI</h2>
        <span className="text-xs text-ink-3">Describe your idea, get creators ranked by how well they fit it.</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void find(); }} className="space-y-2">
        <textarea value={idea} onChange={(e) => setIdea(e.target.value.slice(0, AI_MATCH.ideaMax))} rows={2} maxLength={AI_MATCH.ideaMax}
          placeholder="e.g. a cinematic 30-second perfume ad with surreal visuals" aria-label="Describe your idea"
          className="w-full resize-none rounded-2xl border border-line bg-card px-4 py-3 text-sm focus:border-amber focus:outline-none focus:ring-4 focus:ring-amber/25" />
        <div className="flex flex-wrap items-center gap-2">
          {AI_FINDER_EXAMPLES.map((x) => (
            <button key={x} type="button" onClick={() => { setIdea(x); void find(x); }} disabled={running}
              className="rounded-full border border-line bg-card px-3 py-1 text-xs text-ink-2 transition-colors hover:border-amber hover:text-ink disabled:opacity-60">{x}</button>
          ))}
          <span className="flex-1" />
          <span className="text-[11px] text-ink-3 tabular-nums">{idea.length}/{AI_MATCH.ideaMax}</span>
          <Button type="submit" variant="primary" loading={running} disabled={tooShort}><Sparkles /> Find creators</Button>
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!!recent.data?.length && (
          <>
            <span className="flex items-center gap-1 text-ink-3"><History className="size-3.5" /> Recent:</span>
            {recent.data.map((s) => (
              <button key={s.id} type="button" onClick={() => {
                setIdea(s.idea);
                setSearch({ search_id: s.id, mode: s.mode, notice: s.notice, total: s.result_count, labels: s.requirements.labels ?? [], summary: s.requirements.summary ?? "" });
              }} className={cn("max-w-56 truncate rounded-full px-2.5 py-1 hover:bg-card", search?.search_id === s.id ? "bg-card font-medium" : "text-ink-2")} title={s.idea}>{s.idea}</button>
            ))}
          </>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-ink-3" htmlFor="ai-brief">Shortlist to</label>
        <Select id="ai-brief" value={briefId ?? ""} onChange={(e) => setBriefId(e.target.value || null)} className="h-8 w-48 text-xs">
          <option value="">No brief (shortlist off)</option>
          {briefs.data?.items.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Select>
      </div>

      {running && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Finding creators">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-96 rounded-[2rem]" />)}
        </div>
      )}
      {search && !running && (
        <div className="space-y-3">
          {search.notice && <p className="rounded-2xl bg-ink/[0.05] px-4 py-2.5 text-xs text-ink-2" role="status">{search.notice}</p>}
          {search.labels.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-ink-3">Looking for:</span>
              {search.labels.map((l) => <Chip key={l} tone="outline">{l}</Chip>)}
            </div>
          )}
          <p className="text-[11px] text-ink-3">Match score = relevance to your idea (similarity, tools, skills, style, experience, availability). It isn&apos;t a rating of talent.</p>
          {results.isPending && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-96 rounded-[2rem]" />)}</div>}
          {results.isError && <ErrorState error={results.error} onRetry={() => results.refetch()} />}
          {results.isSuccess && items.length === 0 && (
            <EmptyState icon={<Sparkles />} title="No creators match yet"
              description="Try naming a tool (e.g. Runway), a style (e.g. cinematic) or the type of content (e.g. product ad) — or describe the mood in other words." />
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <CreatorResultCard key={r.creator.id} creator={r.creator} score={r.score} scoreLabel="match score"
                scoreTitle="Relevance to your idea — not a rating of talent" compactActions
                footer={<ResultActions r={r} searchId={search.search_id} briefId={briefId}
                  onSaved={() => qc.invalidateQueries({ queryKey: ["ai-results", search.search_id] })} />} />
            ))}
          </div>
          {results.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={results.isFetchingNextPage} onClick={() => results.fetchNextPage()}>Show more creators</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
