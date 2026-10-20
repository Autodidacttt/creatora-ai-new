"use client";

import { useState } from "react";
import { Globe, Lightbulb, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { errorMessage } from "@/lib/utils";

interface LinkResult { url: string; title: string | null; summary: { summary: string; brand: string | null; product: string | null; key_points: string[] }; model: string | null }

/** Step 1: the brand's idea in their own words and/or a reference link (fetched + summarised server-side). */
export function StepIdea({ idea, url, urlSummary, onChange }: {
  idea: string;
  url: string | null;
  urlSummary: string | null;
  onChange: (p: { idea?: string; url?: string | null; urlSummary?: string | null }) => void;
}) {
  const [link, setLink] = useState(url ?? "");
  const [busy, setBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<boolean | null>(null);

  async function fetchLink() {
    if (!/^https?:\/\/\S+\.\S+/i.test(link.trim())) return toast.error("Enter a full link starting with https://");
    setBusy(true);
    try {
      const res = await fetch("/api/studio/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: link.trim() }) });
      const body = (await res.json()) as LinkResult & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't read that page");
      const text = [body.summary.summary, ...body.summary.key_points.map((k) => `• ${k}`)].join("\n");
      setAiSummary(!!body.model);
      onChange({ url: body.url, urlSummary: text });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Field label={<span className="flex items-center gap-2"><Lightbulb className="size-4" /> Your idea</span>} htmlFor="idea"
        hint="A sentence or two is enough: what you're launching, for whom, where it runs, budget if you know it.">
        <Textarea id="idea" rows={6} value={idea} maxLength={4000} onChange={(e) => onChange({ idea: e.target.value })}
          placeholder="e.g. We're launching a sparkling yuzu soda for Gen Z in Spain and Portugal. We need 3 vertical AI videos for TikTok and Reels, playful and sun-drenched, budget around €6k." />
      </Field>
      <div className="space-y-2">
        <label htmlFor="ref-link" className="flex items-center gap-2 text-sm font-medium"><Globe className="size-4" /> Reference link <span className="text-xs font-normal text-ink-3">optional</span></label>
        <div className="flex gap-2">
          <Input id="ref-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://your-product-page.com"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchLink(); } }} />
          <Button onClick={fetchLink} loading={busy} disabled={!link.trim()}>{busy ? "Reading…" : "Fetch & summarise"}</Button>
        </div>
        <p className="text-xs text-ink-3">We fetch the page on our server (public pages only) and summarise it for the brief.</p>
      </div>
      {busy && <p className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" /> Reading the page…</p>}
      {urlSummary && (
        <Field label="Page summary" htmlFor="url-sum" hint={aiSummary === false ? "AI summary unavailable — this is the page's own title and description. Edit freely." : "Edit anything that's wrong — this feeds the AI brief."}>
          <Textarea id="url-sum" rows={5} value={urlSummary} maxLength={3000} onChange={(e) => onChange({ urlSummary: e.target.value })} />
        </Field>
      )}
    </div>
  );
}
