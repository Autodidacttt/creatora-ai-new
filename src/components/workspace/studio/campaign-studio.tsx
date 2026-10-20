"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CloudOff, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { CampaignCard } from "@/types/app";
import { useDb } from "@/features/session";
import { useLookups } from "@/hooks/use-lookups";
import { useDebounced } from "@/hooks/use-debounce";
import { getBrandCampaigns, getCampaign } from "@/services/campaigns";
import { saveStudioDraft, type StudioDraft } from "@/services/workspace";
import { studioBriefSchema, STUDIO_ASPECTS, type StudioBrief } from "@/lib/validation/workspace";
import { Button } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { cn, errorMessage, timeAgo } from "@/lib/utils";
import { briefProblem, cleanBrief, emptyBrief, mapIds } from "./brief-utils";
import { StepIdea } from "./step-idea";
import { requestBrief, StepBrief } from "./step-brief";
import { StepGuidelines } from "./step-guidelines";
import { StepCreators } from "./step-creators";

const STEPS = ["Idea", "AI brief", "Brand guidelines", "Find creators"] as const;
type Step = 1 | 2 | 3 | 4;

/** Rebuilds the editable brief from a saved campaign (the stored AI brief, or the classic columns). */
function briefFromCampaign(c: CampaignCard): StudioBrief {
  const parsed = studioBriefSchema.safeParse(c.ai_brief);
  if (parsed.success) return parsed.data;
  const b = emptyBrief(c.description);
  return {
    ...b,
    title: c.title,
    objective: c.description.split("\n\n")[0]?.slice(0, 600) ?? "",
    summary: c.description.slice(0, 2000),
    audience: c.target_audience ?? "",
    deliverables: c.deliverables ? c.deliverables.split("\n").map((l) => l.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean).slice(0, 12) : [""],
    content_type: c.content_type?.name ?? null,
    style: c.style?.name ?? null,
    category: c.category?.name ?? null,
    platforms: c.platforms.map((p) => p.name),
    aspect_ratios: c.aspect_ratios.filter((a): a is StudioBrief["aspect_ratios"][number] => (STUDIO_ASPECTS as readonly string[]).includes(a)),
    budget: { min: c.budget_min, max: c.budget_max, currency: c.currency as StudioBrief["budget"]["currency"], guidance: "" },
    suggested_tools: c.suggested_tools?.length ? c.suggested_tools : c.tools.map((t) => t.name),
    production: { camera: c.production_notes?.camera ?? "", lighting: c.production_notes?.lighting ?? "", style: c.production_notes?.style ?? "", format: c.production_notes?.format ?? "" },
    ip: {
      usage_rights: c.usage_rights as StudioBrief["ip"]["usage_rights"], territory: c.territory,
      usage_duration: c.usage_duration as StudioBrief["ip"]["usage_duration"], exclusivity: c.exclusivity as StudioBrief["ip"]["exclusivity"],
      license_type: c.license_type as StudioBrief["ip"]["license_type"], ai_disclosure_required: c.ai_disclosure_required, notes: c.ip_terms?.notes ?? "",
    },
    creators_needed: c.creators_needed,
  };
}

function draftFromCampaign(c: CampaignCard): StudioDraft {
  const hasBrief = !!c.ai_brief || (c.studio_step ?? 1) > 1 || !c.source_idea;
  return {
    id: c.id,
    step: (Math.min(4, Math.max(1, c.studio_step ?? 1)) as Step),
    idea: c.source_idea ?? "",
    url: c.source_url ?? null,
    urlSummary: c.source_summary ?? null,
    brief: hasBrief ? briefFromCampaign(c) : null,
    ids: { content_type_id: c.content_type_id, style_id: c.style_id, category_id: c.category_id, platform_ids: c.platforms.map((p) => p.id), tool_ids: c.tools.map((t) => t.id) },
    guidelineId: c.guideline_id ?? null,
    aiAssisted: c.ai_assisted,
  };
}

const NEW: StudioDraft = {
  id: null, step: 1, idea: "", url: null, urlSummary: null, brief: null,
  ids: { content_type_id: null, style_id: null, category_id: null, platform_ids: [], tool_ids: [] }, guidelineId: null, aiAssisted: false,
};

/** Loads an existing draft (or starts fresh), then hands a stable initial state to the editor. */
export function CampaignStudio({ campaignId }: { campaignId: string | null }) {
  const db = useDb();
  const existing = useQuery({ queryKey: ["studio", campaignId], queryFn: () => getCampaign(db, campaignId!), enabled: !!campaignId, staleTime: Infinity });
  if (!campaignId) return <StudioEditor initial={NEW} published={false} />;
  if (existing.isPending) return <Skeleton className="h-96 rounded-[2rem]" />;
  if (existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (!existing.data) return <ErrorState error="This draft wasn't found." />;
  // Published campaigns are edited in the classic editor; Studio only shows their matches.
  return <StudioEditor initial={draftFromCampaign(existing.data)} published={existing.data.status !== "draft"} />;
}

function StudioEditor({ initial, published }: { initial: StudioDraft; published: boolean }) {
  const db = useDb();
  const lookups = useLookups();
  const drafts = useQuery({ queryKey: ["campaigns", "draft"], queryFn: () => getBrandCampaigns(db, { status: "draft" }), enabled: !initial.id });
  const [d, setD] = useState<StudioDraft>(initial);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // Refs so the serialised save queue always writes the latest state and never creates the draft twice
  const latest = useRef<StudioDraft>(initial);
  const idRef = useRef<string | null>(initial.id);
  const dirty = useRef(false);
  const queue = useRef<Promise<string | null>>(Promise.resolve(null));
  useEffect(() => { latest.current = d; }, [d]);

  const update = (patch: Partial<StudioDraft>) => { dirty.current = true; setD((x) => ({ ...x, ...patch })); };

  const flush = useCallback((): Promise<string | null> => {
    queue.current = queue.current.then(async () => {
      const snap = latest.current;
      const meaningful = snap.idea.trim().length >= 10 || !!snap.urlSummary || !!snap.brief;
      if (!meaningful) return idRef.current;
      dirty.current = false;
      setSaveState("saving");
      try {
        const id = await saveStudioDraft(db, { ...snap, id: idRef.current, ids: mapIds(snap.brief, lookups.data) });
        if (!idRef.current) {
          idRef.current = id;
          setD((x) => ({ ...x, id }));
          // Keep the URL resumable without re-running the server page
          window.history.replaceState(null, "", `/brand/campaigns/studio?id=${id}`);
        }
        setSaveState("saved");
        setSavedAt(new Date().toISOString());
        return id;
      } catch (e) {
        dirty.current = true;
        setSaveState("error");
        toast.error(`Autosave failed: ${errorMessage(e)}`);
        return idRef.current;
      }
    });
    return queue.current;
  }, [db, lookups.data]);

  const debounced = useDebounced(d, 1200);
  useEffect(() => {
    if (dirty.current) void flush();
  }, [debounced, flush]);

  async function generate(fresh = false) {
    setGenerating(true);
    try {
      const { brief } = await requestBrief({ idea: d.idea, link_summary: d.urlSummary });
      setAiNote(null);
      update({ brief, aiAssisted: true, step: 2 });
      if (fresh) toast.success("Brief regenerated");
    } catch (e) {
      const msg = errorMessage(e);
      setAiNote(`${msg} You can write the brief yourself below.`);
      if (!d.brief) update({ brief: emptyBrief(d.idea || d.urlSummary || ""), step: 2 });
      else toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function go(next: Step) {
    if (next >= 2 && d.idea.trim().length < 10 && !d.urlSummary) return toast.error("Describe your idea in a sentence or two, or add a link.");
    if (next === 2 && !d.brief) return generate();
    let brief = d.brief;
    if (next >= 3) {
      const problem = briefProblem(brief);
      if (problem) return toast.error(problem);
      brief = brief ? cleanBrief(brief) : brief;
    }
    update({ step: next, brief });
    if (next === 4) {
      latest.current = { ...d, brief, step: next };
      await flush();
    }
  }

  const step: Step = published ? 4 : d.step;
  const problem = briefProblem(d.brief);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/campaigns" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" /> Campaigns</Link>
          <p className="eyebrow">Campaign Studio</p>
          <h1 className="display text-3xl sm:text-4xl">{d.brief?.title || "New campaign"}</h1>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-ink-3" role="status" aria-live="polite">
          {saveState === "saving" ? <><Loader2 className="size-3.5 animate-spin" /> Saving…</>
            : saveState === "error" ? <><CloudOff className="size-3.5 text-danger" /> Not saved — <button className="underline" onClick={() => flush()}>retry</button></>
              : savedAt ? <><Check className="size-3.5 text-success" /> Draft saved {timeAgo(savedAt)}</> : d.id ? "Draft" : "Autosaves as you type"}
        </p>
      </div>

      <ol className="glass grid grid-cols-4 gap-1 rounded-full p-1" aria-label="Studio steps">
        {STEPS.map((label, i) => {
          const n = (i + 1) as Step;
          const done = step > n;
          return (
            <li key={label}>
              <button type="button" onClick={() => !published && go(n)} aria-current={step === n ? "step" : undefined} disabled={published && n !== 4}
                className={cn("flex w-full items-center justify-center gap-1.5 rounded-full px-2 py-2 text-xs font-medium transition-colors disabled:opacity-60 sm:text-sm",
                  step === n ? "bg-amber text-on-amber shadow-sm" : done ? "text-ink hover:bg-ink/5" : "text-ink-3 hover:bg-ink/5")}>
                <span className={cn("grid size-5 place-items-center rounded-full text-[10px]", step === n ? "bg-on-amber/15" : done ? "bg-success/15 text-success" : "bg-ink/10")}>
                  {done ? <Check className="size-3" /> : n}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {published && (
        <p className="rounded-2xl bg-ink/[0.04] px-4 py-3 text-sm text-ink-2">
          This campaign is live. Edit the brief in the <Link href={`/campaigns/${d.id}/edit`} className="underline">campaign editor</Link>; here you can keep finding and inviting creators.
        </p>
      )}

      {step === 1 && !d.id && (drafts.data?.items.length ?? 0) > 0 && (
        <div className="glass rounded-[1.75rem] p-4">
          <p className="mb-2 text-xs font-semibold text-ink-2">Continue a draft</p>
          <div className="flex flex-wrap gap-2">
            {drafts.data!.items.slice(0, 6).map((c) => (
              <Link key={c.id} href={`/brand/campaigns/studio?id=${c.id}`} className="rounded-full border border-line bg-card px-3 py-1.5 text-xs hover:-translate-y-0.5">
                {c.title} <span className="text-ink-3">· {timeAgo(c.updated_at)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {step === 1 && <StepIdea idea={d.idea} url={d.url} urlSummary={d.urlSummary} onChange={(p) => update(p)} />}
      {step === 2 && d.brief && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-2">{d.aiAssisted ? "Structured by AI from your idea — edit anything inline." : "Fill in the brief below."}</p>
            <Button size="sm" variant="secondary" loading={generating} onClick={() => generate(true)}><RefreshCw /> {d.aiAssisted ? "Regenerate whole brief" : "Try AI again"}</Button>
          </div>
          <StepBrief brief={d.brief} onChange={(brief) => update({ brief })} lookups={lookups.data} idea={d.idea} linkSummary={d.urlSummary} aiNote={aiNote} />
        </>
      )}
      {step === 3 && <StepGuidelines guidelineId={d.guidelineId} onSelect={(guidelineId) => update({ guidelineId })} />}
      {step === 4 && (d.id ? <StepCreators campaignId={d.id} canPublish={!problem} publishProblem={problem} /> : <Skeleton className="h-64 rounded-[1.75rem]" />)}

      {!published && (
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <Button variant="ghost" disabled={step === 1} onClick={() => update({ step: (step - 1) as Step })}><ArrowLeft /> Back</Button>
          {step === 1 && (
            <Button variant="primary" size="lg" loading={generating} onClick={() => go(2)}>
              <Sparkles /> {d.brief ? "Continue to brief" : generating ? "Writing your brief…" : "Generate AI brief"}
            </Button>
          )}
          {step === 2 && <Button variant="primary" onClick={() => go(3)}>Brand guidelines <ArrowRight /></Button>}
          {step === 3 && <Button variant="primary" onClick={() => go(4)}>{d.guidelineId ? "Find creators" : "Skip — find creators"} <ArrowRight /></Button>}
        </div>
      )}
    </div>
  );
}
