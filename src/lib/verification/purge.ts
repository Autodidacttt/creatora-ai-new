// ID-image retention purge. Used by server routes and the regression tests (no "server-only" import); never import
// it from client components.
import type { SupabaseClient } from "@supabase/supabase-js";
import { verificationSettings } from "./settings";

export const BUCKET_IDENTITY = "identity-documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export type PurgeTrigger = "cron" | "app";
export type PurgeResult = {
  /** Images past retention at the start of the run */
  due: number;
  /** Removed from storage by this run */
  deleted: number;
  /** Already gone from storage (e.g. a previous run removed it but couldn't mark it); marked now */
  already_missing: number;
  /** Rows marked as purged by this run (one audit entry each) */
  marked: number;
  /** Marked by a concurrent / earlier run in the meantime — nothing to do */
  already_marked: number;
  /** Still stored or not marked; retried on the next run */
  failed: number;
  /** Cron runs only: stored images no row points at (report-only, never deleted) */
  orphans?: number;
};

export class PurgeQueryError extends Error {}

const EMPTY: PurgeResult = { due: 0, deleted: 0, already_missing: 0, marked: 0, already_marked: 0, failed: 0 };

/**
 * Deletes ID images ID_RETENTION_DAYS after the decision and marks them purged. Safe to repeat or run concurrently:
 * selection is state-based, storage removal is idempotent and identity_image_purged marks (and audits) a row once,
 * only after the image is really gone. Failures are audit-logged (verification id + step, nothing personal) and the
 * row stays due, so the next run retries it. Throws PurgeQueryError if the due images can't be read.
 * App-triggered runs are throttled to one per 10 minutes per server instance.
 */
let lastPurge = 0;
export async function purgeExpiredIdImages(admin: Admin, opts: { trigger: PurgeTrigger; force?: boolean }): Promise<PurgeResult> {
  if (!opts.force && Date.now() - lastPurge < 10 * 60_000) return { ...EMPTY };
  lastPurge = Date.now();
  const { data, error } = await admin.rpc("identity_images_due", { p_days: verificationSettings().retentionDays, p_limit: 100 });
  if (error) {
    console.error(`identity purge (${opts.trigger}): couldn't read due images`, error.code ?? "");
    throw new PurgeQueryError("Couldn't read the ID images due for deletion.");
  }
  const due = (data ?? []) as { id: string; id_image_path: string }[];
  const result: PurgeResult = { ...EMPTY, due: due.length };
  const failures: { id: string; step: "storage" | "mark" }[] = [];

  if (due.length) {
    // remove() only lists the objects it actually deleted; an already-missing one is left out without an error
    const removed = await admin.storage.from(BUCKET_IDENTITY).remove(due.map((d) => d.id_image_path));
    if (removed.error) {
      for (const d of due) failures.push({ id: d.id, step: "storage" });
    } else {
      const gone = new Set((removed.data ?? []).map((o) => o.name));
      for (const d of due) {
        const deletedNow = gone.has(d.id_image_path);
        if (deletedNow) result.deleted++;
        // The database marks the row only if the object is absent from storage, and only once
        const { data: mark, error: markError } = await admin.rpc("identity_image_purged", { p_id: d.id });
        if (markError || mark === "object_present") failures.push({ id: d.id, step: markError ? "mark" : "storage" });
        else if (mark === "already_marked") result.already_marked++;
        else {
          result.marked++;
          if (!deletedNow) result.already_missing++;
        }
      }
    }
  }
  result.failed = failures.length;

  if (opts.trigger === "cron") {
    const { data: orphans, error: orphanError } = await admin.rpc("identity_orphan_images", { p_min_age_hours: 24, p_limit: 1000 });
    if (!orphanError) result.orphans = (orphans ?? []).length;
  }

  const audit: { actor_id: null; action: string; target_type: string; target_id: string; meta: Record<string, unknown> }[] = failures.map((f) => ({
    actor_id: null, action: "identity_image_purge_failed", target_type: "identity_verification", target_id: f.id,
    meta: { step: f.step, trigger: opts.trigger },
  }));
  // One summary per run that had something to do (app runs can happen every 10 minutes)
  if (result.due || result.orphans) {
    audit.push({ actor_id: null, action: "identity_image_purge_run", target_type: "identity_purge", target_id: opts.trigger, meta: { ...result, trigger: opts.trigger } });
  }
  if (audit.length) {
    const { error: auditError } = await admin.from("audit_logs").insert(audit);
    if (auditError) console.error(`identity purge (${opts.trigger}): couldn't write the audit log`, auditError.code ?? "");
  }
  if (result.failed) console.error(`identity purge (${opts.trigger}): ${result.failed} of ${result.due} image(s) not purged; retrying next run`, JSON.stringify(result));
  return result;
}
