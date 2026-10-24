import { NextResponse } from "next/server";
import { apiSession } from "@/lib/auth";
import { getServerClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimited } from "@/lib/rate-limit";
import { MAX_FILES_PER_SUBMISSION, submissionFileSchema } from "@/lib/validation/workspace";
import { addLinkFile, processSubmissionFile, removeSubmissionFile } from "@/lib/workspace/pipeline";

// Video previews are transcoded here (ffmpeg); give it room.
export const maxDuration = 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's own draft, read with THEIR client (RLS) — the access check for everything below. */
async function ownDraft(id: string, userId: string) {
  const db = await getServerClient();
  const { data } = await db.from("submissions").select("id, creator_id, status").eq("id", id).maybeSingle();
  if (!data || data.creator_id !== userId) return { error: NextResponse.json({ error: "Submission not found." }, { status: 404 }) } as const;
  if (data.status !== "draft") return { error: NextResponse.json({ error: "This version was already submitted." }, { status: 409 }) } as const;
  return { db } as const;
}

/** Registers an uploaded original (or a link) on the creator's draft and builds its watermarked preview. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["creator"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  const me = auth.session.profile;

  const parsed = submissionFileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid file" }, { status: 400 });
  if (rateLimited(`files:${me.id}`, 30)) return NextResponse.json({ error: "Too many uploads — wait a minute." }, { status: 429 });

  const draft = await ownDraft(id, me.id);
  if ("error" in draft) return draft.error;
  const { count } = await draft.db.from("submission_files").select("id", { count: "exact", head: true }).eq("submission_id", id);
  if ((count ?? 0) >= MAX_FILES_PER_SUBMISSION) {
    return NextResponse.json({ error: `Up to ${MAX_FILES_PER_SUBMISSION} files per version.` }, { status: 400 });
  }

  try {
    const admin = getAdminClient();
    const file = parsed.data.kind === "link"
      ? await addLinkFile(admin, id, parsed.data.url, parsed.data.position)
      : await processSubmissionFile(admin, {
          submissionId: id, creatorId: me.id, username: me.username, path: parsed.data.path, name: parsed.data.name,
          mime: parsed.data.mime, position: parsed.data.position, clientFramePaths: parsed.data.frames, clientMeta: parsed.data.meta,
        });
    return NextResponse.json({ file });
  } catch (err) {
    console.error("[submissions/files]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't process that file." }, { status: 422 });
  }
}

/** Removes a file from the creator's own draft (row + original + previews). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiSession(["creator"]);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const fileId = new URL(request.url).searchParams.get("file") ?? "";
  if (!UUID.test(id) || !UUID.test(fileId)) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const draft = await ownDraft(id, auth.session.profile.id);
  if ("error" in draft) return draft.error;
  // Ownership was checked above; the original's storage path is server-only, so read the row with the service role
  const admin = getAdminClient();
  const { data: file } = await admin.from("submission_files")
    .select("id, submission_id, storage_path, preview_path, thumbnail_path, frame_paths").eq("id", fileId).eq("submission_id", id).maybeSingle();
  if (!file) return NextResponse.json({ error: "File not found." }, { status: 404 });
  await removeSubmissionFile(admin, file, auth.session.profile.id);
  return NextResponse.json({ ok: true });
}
