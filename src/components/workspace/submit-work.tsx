"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudUpload, Link2, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ProjectDetail, Submission } from "@/types/workspace";
import { useDb } from "@/features/session";
import {
  addSubmissionLink, createSubmission, removeSubmissionFile, saveSubmissionDraft, submitSubmission, uploadSubmissionFile,
} from "@/services/workspace";
import { MAX_FILES_PER_SUBMISSION, MAX_UPLOAD_BYTES, SUBMISSION_MIME, submissionDetailsSchema } from "@/lib/validation/workspace";
import { useDebounced } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PillCTA } from "@/components/ui/pill-cta";
import { cn, errorMessage } from "@/lib/utils";
import { MediaThumb, previewPaths, useSignedPreviews } from "./media";

interface Pending { key: string; name: string; state: "uploading" | "error"; error?: string }

function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const v = t.trim();
    if (v && !value.some((x) => x.toLowerCase() === v.toLowerCase()) && value.length < 20) onChange([...value, v.slice(0, 80)]);
    setDraft("");
  };
  const rest = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2.5 py-1 text-xs font-medium">
            {t}<button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}><X className="size-3" /></button>
          </span>
        ))}
      </div>
      <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a tool or model and press Enter"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); } }} onBlur={() => draft && add(draft)} />
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] text-ink-3">From the brief:</span>
          {rest.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-line px-2 py-0.5 text-[11px] hover:bg-ink/5">+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The creator's composer for the next version: files/links, notes, tools, workflow and the declaration. */
export function SubmitWork({ project, draft, onChanged, onSubmitted }: {
  project: ProjectDetail;
  draft: Submission | null;
  onChanged: () => void;
  onSubmitted: () => void;
}) {
  const db = useDb();
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [tools, setTools] = useState<string[]>(draft?.tools_used ?? []);
  const [workflow, setWorkflow] = useState(draft?.workflow_notes ?? "");
  const [declAi, setDeclAi] = useState(false);
  const [declTerms, setDeclTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const files = draft?.files ?? [];
  const urls = useSignedPreviews(files.flatMap(previewPaths));
  const version = (project.submissions.filter((s) => s.status !== "draft")[0]?.version ?? 0) + 1;
  const suggestions = [...project.campaign_card.tools.map((t) => t.name), ...(project.campaign_card.suggested_tools ?? [])];
  const closed = project.campaign.is_sprint && project.campaign.sprint_closed;

  useEffect(() => { if (draft?.id) setDraftId(draft.id); }, [draft?.id]);

  async function ensureDraft() {
    if (draftId) return draftId;
    const id = await createSubmission(db, project.id);
    setDraftId(id);
    return id;
  }

  // Autosave the text fields to the draft
  const debounced = useDebounced(JSON.stringify({ notes, tools, workflow }), 900);
  const lastSaved = useRef(debounced);
  useEffect(() => {
    if (!draftId || debounced === lastSaved.current) return;
    lastSaved.current = debounced;
    const v = JSON.parse(debounced) as { notes: string; tools: string[]; workflow: string };
    saveSubmissionDraft(db, draftId, { notes: v.notes || null, tools_used: v.tools, workflow_notes: v.workflow || null }).catch(() => undefined);
  }, [debounced, draftId, db]);

  async function addFiles(list: FileList | File[]) {
    const arr = Array.from(list);
    if (files.length + pending.length + arr.length > MAX_FILES_PER_SUBMISSION) return toast.error(`Up to ${MAX_FILES_PER_SUBMISSION} files per version.`);
    let id: string;
    try { id = await ensureDraft(); } catch (e) { return toast.error(errorMessage(e)); }
    await Promise.all(arr.map(async (file, i) => {
      const key = `${file.name}-${file.size}-${Date.now()}-${i}`;
      if (!(SUBMISSION_MIME as readonly string[]).includes(file.type)) return toast.error(`${file.name}: use JPG, PNG, WebP, MP4, WebM or MOV.`);
      if (file.size > MAX_UPLOAD_BYTES) return toast.error(`${file.name} is over 50 MB.`);
      setPending((p) => [...p, { key, name: file.name, state: "uploading" }]);
      try {
        await uploadSubmissionFile(db, id, file, files.length + i);
        setPending((p) => p.filter((x) => x.key !== key));
        onChanged();
      } catch (e) {
        setPending((p) => p.map((x) => (x.key === key ? { ...x, state: "error", error: errorMessage(e) } : x)));
      }
    }));
  }

  async function addLink() {
    const url = link.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) return toast.error("Enter a full link starting with https://");
    try {
      const id = await ensureDraft();
      await addSubmissionLink(id, url, files.length);
      setLink("");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function submit() {
    const parsed = submissionDetailsSchema.safeParse({
      notes: notes.trim() || null, tools_used: tools, workflow_notes: workflow.trim() || null,
      ai_generated_declared: declAi, commercial_terms_accepted: declTerms,
    });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Check the form");
    if (!draftId || files.length === 0) return toast.error("Add at least one file or link.");
    setBusy(true);
    try {
      await submitSubmission(draftId, parsed.data);
      toast.success(`Version ${version} submitted — the brand has been notified`);
      onSubmitted();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return <p className="rounded-2xl bg-ink/[0.05] p-4 text-sm text-ink-2">This sprint closed at its deadline. Submissions are no longer accepted.</p>;
  }

  return (
    <section className="glass space-y-5 rounded-[1.75rem] p-5 sm:p-6" aria-labelledby="submit-h">
      <div>
        <h2 id="submit-h" className="display text-xl">{version > 1 ? `Submit version ${version}` : "Submit your work"}</h2>
        <p className="mt-1 text-xs text-ink-2">Originals stay private. The brand only sees watermarked previews until they approve the work and fund escrow.</p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        className={cn("rounded-2xl border-2 border-dashed p-5 text-center transition-colors", drag ? "border-amber bg-amber-soft/50" : "border-line")}
      >
        <CloudUpload className="mx-auto size-7 text-ink-3" aria-hidden />
        <p className="mt-2 text-sm">Drop images or videos here</p>
        <p className="text-xs text-ink-3">JPG, PNG, WebP, MP4, WebM, MOV · up to 50 MB each · {MAX_FILES_PER_SUBMISSION} files max</p>
        <Button size="sm" className="mt-3" onClick={() => inputRef.current?.click()}><Plus /> Choose files</Button>
        <input ref={inputRef} type="file" multiple hidden accept={SUBMISSION_MIME.join(",")} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
      </div>

      <div className="flex gap-2">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…or paste a link (Vimeo, YouTube, Drive)" aria-label="Link to your work"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }} />
        <Button onClick={addLink} disabled={!link.trim()}><Link2 /> Add</Button>
      </div>

      {(files.length > 0 || pending.length > 0) && (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-2xl bg-card/70 p-2 pr-3">
              <MediaThumb mediaType={f.media_type} path={f.thumbnail_path} urls={urls.data} className="size-12" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.file_name ?? f.link_url}</span>
                <span className="flex items-center gap-1 text-[11px] text-success"><CheckCircle2 className="size-3" /> {f.kind === "link" ? "Link added" : f.preview_kind === "video_ffmpeg" ? "Watermarked video preview ready" : f.preview_kind === "video_frames" ? "Watermarked frames ready" : "Watermarked preview ready"}</span>
              </span>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.file_name ?? "file"}`} onClick={async () => {
                try { await removeSubmissionFile(f.submission_id, f.id); onChanged(); } catch (e) { toast.error(errorMessage(e)); }
              }}><Trash2 /></Button>
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.key} className="flex items-center gap-3 rounded-2xl bg-card/70 p-3 text-sm">
              {p.state === "uploading" ? <Loader2 className="size-4 animate-spin text-ink-3" /> : <X className="size-4 text-danger" />}
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className={cn("text-xs", p.state === "error" ? "text-danger" : "text-ink-3")}>{p.state === "uploading" ? "Uploading & watermarking…" : p.error}</span>
              {p.state === "error" && <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}><X /></Button>}
            </li>
          ))}
        </ul>
      )}

      <Field label="Notes for the brand" htmlFor="sub-notes" optional>
        <Textarea id="sub-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="What you made, what changed since the last version, anything to look out for." />
      </Field>
      <Field label="AI tools & models used" htmlFor="sub-tools" hint="Listed on the licence record if this version is approved.">
        <TagInput value={tools} onChange={setTools} suggestions={suggestions} />
      </Field>
      <Field label="Workflow notes" htmlFor="sub-workflow" optional>
        <Textarea id="sub-workflow" value={workflow} onChange={(e) => setWorkflow(e.target.value)} maxLength={4000} className="min-h-16" placeholder="Prompts, seeds, upscaling, edit steps…" />
      </Field>

      <fieldset className="space-y-2 rounded-2xl bg-card/60 p-4">
        <legend className="sr-only">Declaration</legend>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-1 accent-amber-2" checked={declAi} onChange={(e) => setDeclAi(e.target.checked)} />
          <span>This work is AI-generated, and the tools/models above are the ones I used.</span>
        </label>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-1 accent-amber-2" checked={declTerms} onChange={(e) => setDeclTerms(e.target.checked)} />
          <span>It meets the brief&apos;s commercial-use terms (usage rights, territory, duration, exclusivity) and I have the rights to license it.</span>
        </label>
      </fieldset>

      <div className="flex justify-end">
        <PillCTA onClick={submit} loading={busy} disabled={!files.length || !declAi || !declTerms || pending.some((p) => p.state === "uploading")}>
          <span className="inline-flex items-center gap-2"><Send className="size-4" /> Submit version {version}</span>
        </PillCTA>
      </div>
    </section>
  );
}
