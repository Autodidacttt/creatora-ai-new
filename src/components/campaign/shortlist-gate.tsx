"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { publishCampaign } from "@/services/workspace";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";

/** Shortlisting is only allowed on a published (active) brief; the database enforces the same rule. */
export const canShortlist = (status: string) => status === "active";
export const SHORTLIST_LOCKED_HINT = "Publish the brief first";

/** Banner shown above shortlist actions while the brief isn't published, with a Publish shortcut for drafts. */
export function ShortlistGate({ campaign, onPublished }: { campaign: { id: string; status: string }; onPublished?: () => void }) {
  const db = useDb();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  if (canShortlist(campaign.status)) return null;
  const draft = campaign.status === "draft";
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber/40 bg-amber-soft/60 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1">
        {draft
          ? <><strong>{SHORTLIST_LOCKED_HINT}.</strong> Creators can only be shortlisted on a published brief. Existing shortlists stay visible.</>
          : <>This brief is {campaign.status}: new shortlists are closed. Existing ones stay visible.</>}
      </span>
      {draft && (
        <Button size="sm" variant="primary" loading={busy} onClick={async () => {
          setBusy(true);
          try {
            await publishCampaign(db, campaign.id);
            toast.success("Brief published — you can shortlist now");
            ["campaign", "pipeline", "matches", "applications", "hiring", "studio"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
            onPublished?.();
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}><Send /> Publish brief</Button>
      )}
    </div>
  );
}
