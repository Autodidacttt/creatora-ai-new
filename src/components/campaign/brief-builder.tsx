"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, Sparkles, Wand2 } from "lucide-react";
import { briefPromptSchema } from "@/lib/validation/schemas";
import { Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export interface AIDraft {
  title: string;
  description: string;
  deliverables: string;
  target_audience: string;
  content_type_id: number | null;
  style_id: number | null;
  category_id: number | null;
  aspect_ratios: string[];
  platform_ids: number[];
  tool_ids: number[];
  skill_ids: number[];
  language_ids: number[];
  budget_min: number | null;
  budget_max: number | null;
  currency: string;
  deadline: string | null;
  creators_needed: number;
  usage_rights: string[];
  territory: string;
  usage_duration: string;
  exclusivity: string;
  license_type: string;
  ai_disclosure_required: boolean;
}

const EXAMPLES = [
  "Need three AI creators for a cinematic fashion campaign for Gen Z on Instagram, launching in 3 weeks, budget around €8k",
  "Looking for a 3D animator to make a 30s product launch film for our new earbuds on YouTube and CTV, exclusive rights in the US",
  "Surreal music-video style TikTok spots for a summer drink in Brazil and Mexico, Spanish and Portuguese versions",
];

/** One-sentence idea -> structured brief (server-side Gemini, schema-validated). Falls back to the manual form. */
export function BriefBuilder({ onDraft }: { onDraft: (draft: AIDraft, assumptions: string[]) => void }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assumptions, setAssumptions] = useState<string[]>([]);

  async function generate() {
    const parsed = briefPromptSchema.safeParse({ prompt });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Describe your idea");
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => ({}))) as { draft?: AIDraft; assumptions?: string[]; error?: string };
      if (!res.ok || !body.draft) throw new Error(body.error ?? "The AI couldn't draft this brief. Fill in the form manually.");
      setAssumptions(body.assumptions ?? []);
      onDraft(body.draft, body.assumptions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI brief builder is unavailable. Fill in the form manually.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="ai-builder" className="relative overflow-hidden rounded-[2rem] bg-ink p-5 text-bg sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-amber/40 blur-3xl" />
      <div className="relative">
        <h2 id="ai-builder" className="display flex items-center gap-2 text-xl">
          <span className="grid size-8 place-items-center rounded-full bg-amber text-on-amber"><Wand2 className="size-4" /></span>
          AI brief builder
        </h2>
        <p className="mt-1 text-sm text-bg/70">Describe the idea in a sentence. We&apos;ll structure it into a full brief you can edit before saving.</p>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={2000}
          aria-label="Describe your campaign idea"
          placeholder="e.g. Need three AI creators for a cinematic fashion campaign for Gen Z on Instagram"
          className="mt-4 border-white/10 bg-white/10 text-bg placeholder:text-bg/40"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setPrompt(ex)} className="rounded-full border border-white/15 px-3 py-1 text-left text-xs text-bg/80 hover:border-amber hover:text-bg">
              {ex.length > 64 ? `${ex.slice(0, 62)}…` : ex}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={generate} loading={loading}><Sparkles /> {loading ? "Structuring your brief…" : "Generate brief"}</Button>
          <span className="text-xs text-bg/50">⌘/Ctrl + Enter</span>
        </div>
        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert"
              className="mt-4 flex items-start gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber" /> {error}
            </motion.p>
          )}
          {assumptions.length > 0 && !error && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-white/10 px-4 py-3 text-sm">
              <p className="font-semibold text-amber">Draft ready — review the form below. The AI assumed:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-bg/80">{assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
