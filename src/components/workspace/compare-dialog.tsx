"use client";

import { useQueries } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import type { CheckStatus, ReviewCheck } from "@/lib/review/ai-review";
import { useDb } from "@/features/session";
import { getSubmissionDetail } from "@/services/workspace";
import { Dialog } from "@/components/ui/overlay";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/states";
import { PreviewViewer, previewPaths, useSignedPreviews } from "./media";
import { SubmissionStatusChip } from "./status";

const ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="size-4 text-success" aria-label="Pass" />,
  warn: <AlertTriangle className="size-4 text-amber-ink" aria-label="Check" />,
  fail: <XCircle className="size-4 text-danger" aria-label="Fail" />,
  na: <MinusCircle className="size-4 text-ink-3" aria-label="Not applicable" />,
};
const ROWS: [string, string][] = [["logo", "Logo"], ["colors", "Colours"], ["visual_style", "Visual style"], ["typography", "Typography"], ["ai_disclosure", "AI disclosure"], ["format", "Format"]];

/** Side-by-side view of 2–3 submissions with their check results. */
export function CompareDialog({ ids, open, onOpenChange }: { ids: string[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useDb();
  const results = useQueries({ queries: ids.map((id) => ({ queryKey: ["submission", id], queryFn: () => getSubmissionDetail(db, id), enabled: open })) });
  const items = results.map((r) => r.data).filter((d): d is NonNullable<typeof d> => !!d);
  const urls = useSignedPreviews(items.flatMap((s) => s.files.slice(0, 1).flatMap(previewPaths)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Compare submissions" size="xl" description="Watermarked previews side by side with their checklist results.">
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, ids.length)}, minmax(0, 1fr))` }}>
        {ids.map((id, i) => {
          const s = results[i]?.data;
          if (!s) return <Skeleton key={id} className="h-96 rounded-[1.5rem]" />;
          return (
            <div key={id} className="min-w-0 space-y-3 rounded-[1.5rem] bg-card/70 p-3">
              <div className="flex items-center gap-2">
                <Avatar src={s.creator.avatar_url} name={s.creator.display_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.creator.display_name}</p>
                  <p className="truncate text-[11px] text-ink-3">{s.campaign.title} · v{s.version}</p>
                </div>
              </div>
              {s.files[0] && <PreviewViewer file={s.files[0]} urls={urls.data} />}
              <div className="flex items-center justify-between">
                <SubmissionStatusChip status={s.status} />
                <span className="text-sm"><span className="display text-2xl tabular-nums">{s.ai?.brand_match_score ?? "—"}</span><span className="text-xs text-ink-3"> /100 brand match</span></span>
              </div>
              <ul className="space-y-1.5 text-xs">
                {ROWS.map(([key, label]) => {
                  const c = (s.ai?.checks as Record<string, ReviewCheck | undefined> | undefined)?.[key];
                  return (
                    <li key={key} className="flex items-start gap-2">
                      {c ? ICON[c.status] : <MinusCircle className="size-4 text-ink-3" aria-label="Pending" />}
                      <span className="min-w-0"><b className="font-medium">{label}</b>{c && <span className="block text-ink-2">{c.explanation}</span>}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
