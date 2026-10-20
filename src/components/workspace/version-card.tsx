"use client";

import { useState } from "react";
import { Download, MessageSquare, Send, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { Submission } from "@/types/workspace";
import { useDb, useMe } from "@/features/session";
import { addSubmissionComment, signOriginal } from "@/services/workspace";
import { commentInputSchema } from "@/lib/validation/workspace";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import { errorMessage, timeAgo } from "@/lib/utils";
import { formatDateTime } from "@/lib/money";
import { ExpandableCard } from "./expandable";
import { MediaThumb, PreviewViewer, previewPaths, useSignedPreviews } from "./media";
import { SubmissionStatusChip } from "./status";

export const fmtTimestamp = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

/** Comment thread on a submitted version (both parties). Video comments can carry a timestamp. */
export function CommentThread({ submission, currentMs, onAdded, fileId }: {
  submission: Submission;
  currentMs?: number | null;
  onAdded: () => void;
  fileId?: string | null;
}) {
  const db = useDb();
  const [body, setBody] = useState("");
  const [stamp, setStamp] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      {submission.comments.length === 0 && <p className="text-xs text-ink-3">No comments yet.</p>}
      <ul className="space-y-2.5">
        {submission.comments.map((c) => (
          <li key={c.id} className="flex gap-2.5">
            <Avatar src={c.author.avatar_url} name={c.author.display_name} size="xs" />
            <div className="min-w-0 flex-1 rounded-2xl bg-card/70 px-3 py-2 text-sm">
              <p className="text-[11px] text-ink-3"><b className="text-ink-2">{c.author.display_name}</b> · {timeAgo(c.created_at)}
                {c.timestamp_ms != null && <span className="ml-1.5 rounded bg-amber-soft px-1 font-mono text-ink">@ {fmtTimestamp(c.timestamp_ms)}</span>}</p>
              <p className="whitespace-pre-line">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {submission.status !== "draft" && (
        <form className="space-y-2" onSubmit={async (e) => {
          e.preventDefault();
          const parsed = commentInputSchema.safeParse({ body, timestamp_ms: stamp && currentMs != null ? currentMs : null, file_id: fileId ?? null });
          if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Write a comment");
          setBusy(true);
          try {
            await addSubmissionComment(db, submission.id, parsed.data.body, parsed.data.timestamp_ms, parsed.data.file_id);
            setBody("");
            onAdded();
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" className="min-h-16" maxLength={2000} aria-label="Comment" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {currentMs != null ? (
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={stamp} onChange={(e) => setStamp(e.target.checked)} className="accent-amber-2" />
                Pin to {fmtTimestamp(currentMs)} in the video
              </label>
            ) : <span />}
            <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!body.trim()}><Send /> Comment</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** One version of the work, collapsed by default (latest open). */
export function VersionCard({ s, defaultOpen, onChanged, canDownloadOriginals }: { s: Submission; defaultOpen?: boolean; onChanged: () => void; canDownloadOriginals?: boolean }) {
  const db = useDb();
  const me = useMe();
  const isCreator = s.creator_id === me.id;
  const urls = useSignedPreviews(s.files.flatMap(previewPaths));
  const [active, setActive] = useState(0);
  const [ms, setMs] = useState<number | null>(null);
  const file = s.files[active];
  const lastReview = s.reviews[s.reviews.length - 1];

  return (
    <ExpandableCard
      defaultOpen={defaultOpen}
      title={`Version ${s.version}`}
      subtitle={s.submitted_at ? `Submitted ${formatDateTime(s.submitted_at)} · ${s.files.length} file${s.files.length === 1 ? "" : "s"}` : "Draft"}
      aside={<SubmissionStatusChip status={s.status} />}
    >
      <div className="space-y-4">
        {lastReview && lastReview.decision !== "approved" && (
          <div className="rounded-2xl border border-danger/20 bg-danger/5 p-3.5 text-sm">
            <p className="text-xs font-semibold text-danger">{lastReview.decision === "rejected" ? "Rejected" : "Changes requested"} by {lastReview.reviewer.display_name} · {timeAgo(lastReview.created_at)}</p>
            <p className="mt-1 whitespace-pre-line">{lastReview.feedback}</p>
          </div>
        )}
        {file && (
          <>
            <PreviewViewer file={file} urls={urls.data} onTime={setMs} />
            {s.files.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Files">
                {s.files.map((f, i) => (
                  <button key={f.id} type="button" role="tab" aria-selected={i === active} onClick={() => { setActive(i); setMs(null); }}
                    className={i === active ? "rounded-xl ring-2 ring-amber" : "rounded-xl opacity-70 hover:opacity-100"}>
                    <MediaThumb mediaType={f.media_type} path={f.thumbnail_path} urls={urls.data} className="size-14" alt={f.file_name ?? ""} />
                  </button>
                ))}
              </div>
            )}
            {(isCreator || canDownloadOriginals) && file.storage_path && (
              <Button size="sm" variant="ghost" onClick={async () => {
                try { window.location.href = await signOriginal(db, file.storage_path!, file.file_name ?? undefined); }
                catch (e) { toast.error(errorMessage(e)); }
              }}><Download /> {isCreator ? "Download my original" : "Download clean original"}</Button>
            )}
          </>
        )}
        {(s.notes || s.tools_used.length > 0 || s.workflow_notes) && (
          <div className="space-y-2 rounded-2xl bg-card/60 p-3.5 text-sm">
            {s.notes && <p className="whitespace-pre-line">{s.notes}</p>}
            {s.tools_used.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><Wrench className="size-3.5 text-ink-3" />{s.tools_used.map((t) => <Chip key={t} tone="outline">{t}</Chip>)}</div>}
            {s.workflow_notes && <p className="whitespace-pre-line text-xs text-ink-2"><b>Workflow:</b> {s.workflow_notes}</p>}
            <p className="text-[11px] text-ink-3">{s.ai_generated_declared ? "✓ Declared AI-generated" : ""}{s.commercial_terms_accepted ? " · ✓ Meets the brief's commercial-use terms (creator's declaration)" : ""}</p>
          </div>
        )}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2"><MessageSquare className="size-3.5" /> Comments</p>
          <CommentThread submission={s} currentMs={file?.media_type === "video" && file.preview_kind === "video_ffmpeg" ? ms : null} fileId={file?.id ?? null} onAdded={onChanged} />
        </div>
      </div>
    </ExpandableCard>
  );
}
