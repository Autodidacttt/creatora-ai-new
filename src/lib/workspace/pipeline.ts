// Submission pipeline: process uploaded originals into watermarked previews, run the AI review job,
// and render licence-record PDFs. Takes a SERVICE-ROLE client — call only after the caller's access
// has been verified with their own (RLS-bound) client. Shared by API routes and the seed script.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { analysisJpeg, processImage, processVideo, sha256 } from "@/lib/media/process";
import { runReview, type ReviewAsset, type ReviewInput } from "@/lib/review/ai-review";
import { certificatePdf, type CertificateData } from "@/lib/pdf/documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export const BUCKET_ORIGINALS = "submissions";
export const BUCKET_PREVIEWS = "submission-previews";
export const BUCKET_CERTIFICATES = "certificates";

export const ALLOWED_MIME: Record<string, { media: "image" | "video"; ext: string }> = {
  "image/jpeg": { media: "image", ext: "jpg" },
  "image/png": { media: "image", ext: "png" },
  "image/webp": { media: "image", ext: "webp" },
  "video/mp4": { media: "video", ext: "mp4" },
  "video/webm": { media: "video", ext: "webm" },
  "video/quicktime": { media: "video", ext: "mov" },
};

async function download(admin: Admin, bucket: string, path: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Couldn't read ${path}: ${error?.message ?? "missing"}`);
  return Buffer.from(await data.arrayBuffer());
}

async function upload(admin: Admin, bucket: string, path: string, body: Buffer | Uint8Array, contentType: string) {
  const { error } = await admin.storage.from(bucket).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`Couldn't store ${path}: ${error.message}`);
}

async function log(admin: Admin, submissionId: string, job: "submission_review" | "watermark" | "certificate", status: "started" | "done" | "failed", message?: string, durationMs?: number) {
  await admin.from("ai_job_logs").insert({ submission_id: submissionId, job, status, message: message?.slice(0, 2000) ?? null, duration_ms: durationMs ?? null });
}

export interface FileJob {
  submissionId: string;
  creatorId: string;
  username: string;
  path: string;
  name: string;
  mime: string;
  position: number;
  clientFramePaths?: string[];
  clientMeta?: { width?: number; height?: number; duration_ms?: number };
}

/** Original → hash, size, palette, watermarked preview(s), private analysis frames, submission_files row. */
export async function processSubmissionFile(admin: Admin, job: FileJob) {
  const prefix = `${job.creatorId}/${job.submissionId}/`;
  if (!job.path.startsWith(prefix) || job.path.includes("..")) throw new Error("File path is outside this submission");
  const kind = ALLOWED_MIME[job.mime];
  if (!kind) throw new Error("Unsupported file type");

  const t0 = Date.now();
  await log(admin, job.submissionId, "watermark", "started", job.name);
  try {
    const original = await download(admin, BUCKET_ORIGINALS, job.path);
    const fileId = randomUUID();
    const label = `CREATORA · @${job.username.slice(0, 24)} · PREVIEW`;
    const pv = (suffix: string) => `${prefix}${fileId}-${suffix}`;
    const an = (i: number) => `${prefix}analysis/${fileId}-${i}.jpg`;
    let row: Record<string, unknown>;

    if (kind.media === "image") {
      const r = await processImage(original, label);
      await upload(admin, BUCKET_PREVIEWS, pv("preview.jpg"), r.preview, "image/jpeg");
      await upload(admin, BUCKET_ORIGINALS, an(0), await analysisJpeg(original), "image/jpeg");
      row = {
        preview_path: pv("preview.jpg"), thumbnail_path: pv("preview.jpg"), preview_kind: "image_watermark",
        width: r.width, height: r.height, palette: r.palette.map((s) => s.hex),
      };
    } else {
      const framePaths = (job.clientFramePaths ?? []).filter((p) => p.startsWith(prefix) && !p.includes("..")).slice(0, 8);
      const clientFrames = await Promise.all(framePaths.map((p) => download(admin, BUCKET_ORIGINALS, p)));
      const r = await processVideo(original, kind.ext, label, clientFrames, {
        width: job.clientMeta?.width, height: job.clientMeta?.height, durationMs: job.clientMeta?.duration_ms,
      });
      if (!r.frames.length) throw new Error(r.note ? `Couldn't make a preview (${r.note})` : "Couldn't make a preview for this video");
      const frames: string[] = [];
      for (const [i, f] of r.frames.entries()) {
        await upload(admin, BUCKET_PREVIEWS, pv(`f${i}.jpg`), f, "image/jpeg");
        frames.push(pv(`f${i}.jpg`));
      }
      for (const [i, f] of r.analysisFrames.entries()) await upload(admin, BUCKET_ORIGINALS, an(i), f, "image/jpeg");
      if (r.preview) await upload(admin, BUCKET_PREVIEWS, pv("preview.mp4"), r.preview, "video/mp4");
      row = {
        preview_path: r.preview ? pv("preview.mp4") : frames[0], thumbnail_path: frames[0], frame_paths: frames,
        preview_kind: r.method, width: r.width, height: r.height, duration_ms: r.durationMs, palette: r.palette.map((s) => s.hex),
      };
      // Client-captured frames were only an input; the watermarked copies replace them
      if (framePaths.length) await admin.storage.from(BUCKET_ORIGINALS).remove(framePaths);
    }

    const { data, error } = await admin.from("submission_files").insert({
      id: fileId, submission_id: job.submissionId, position: job.position, kind: "upload", media_type: kind.media,
      file_name: job.name.slice(0, 200), mime_type: job.mime, size_bytes: original.length, storage_path: job.path,
      sha256: sha256(original), ...row,
    }).select("*").single();
    if (error) throw new Error(error.message);
    await log(admin, job.submissionId, "watermark", "done", `${row.preview_kind}: ${job.name}`, Date.now() - t0);
    return data;
  } catch (err) {
    await log(admin, job.submissionId, "watermark", "failed", err instanceof Error ? err.message : String(err), Date.now() - t0);
    throw err;
  }
}

export async function addLinkFile(admin: Admin, submissionId: string, url: string, position: number) {
  const { data, error } = await admin.from("submission_files").insert({
    submission_id: submissionId, position, kind: "link", media_type: "link", link_url: url, preview_kind: "external_link",
    file_name: url.slice(0, 200),
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

/** Removes a draft file's row and every stored object derived from it. */
export async function removeSubmissionFile(admin: Admin, file: { id: string; submission_id: string; storage_path: string | null; preview_path: string | null; thumbnail_path: string | null; frame_paths: string[] }, creatorId: string) {
  const prefix = `${creatorId}/${file.submission_id}/`;
  const analysis = (await admin.storage.from(BUCKET_ORIGINALS).list(`${prefix}analysis`, { limit: 100 })).data ?? [];
  await admin.storage.from(BUCKET_ORIGINALS).remove([
    ...(file.storage_path ? [file.storage_path] : []),
    ...analysis.filter((o) => o.name.startsWith(file.id)).map((o) => `${prefix}analysis/${o.name}`),
  ]);
  const previews = [file.preview_path, file.thumbnail_path, ...file.frame_paths].filter((p): p is string => !!p);
  if (previews.length) await admin.storage.from(BUCKET_PREVIEWS).remove([...new Set(previews)]);
  await admin.from("submission_files").delete().eq("id", file.id);
}

// ---------------------------------------------------------------------------
// AI review job
// ---------------------------------------------------------------------------
async function fetchLogo(url: string | null): Promise<Buffer | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return null;
    return await sharp(buf).flatten({ background: "#ffffff" }).resize(512, 512, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return null;
  }
}

export async function runSubmissionReview(admin: Admin, submissionId: string, ai: GoogleGenAI | null) {
  const t0 = Date.now();
  const { data: prev } = await admin.from("ai_review_results").select("attempts").eq("submission_id", submissionId).maybeSingle();
  await admin.from("ai_review_results").upsert(
    { submission_id: submissionId, status: "running", attempts: (prev?.attempts ?? 0) + 1, error: null },
    { onConflict: "submission_id" },
  );
  await log(admin, submissionId, "submission_review", "started");
  try {
    const { data: s, error } = await admin.from("submissions")
      .select("id, version, creator_id, campaign_id, notes, tools_used, workflow_notes, ai_generated_declared, submission_files(*)")
      .eq("id", submissionId).single();
    if (error || !s) throw new Error(error?.message ?? "Submission not found");
    const { data: c } = await admin.from("campaigns")
      .select("title, description, deliverables, aspect_ratios, ai_disclosure_required, suggested_tools, guideline_id, styles(name), content_types(name), campaign_tools(ai_tools(name))")
      .eq("id", s.campaign_id).single();
    if (!c) throw new Error("Campaign not found");
    const { data: g } = c.guideline_id
      ? await admin.from("brand_guidelines").select("*").eq("id", c.guideline_id).maybeSingle()
      : { data: null };

    const prefix = `${s.creator_id}/${s.id}/`;
    const stored = (await admin.storage.from(BUCKET_ORIGINALS).list(`${prefix}analysis`, { limit: 200, sortBy: { column: "name", order: "asc" } })).data ?? [];
    type FileRow = { id: string; media_type: "image" | "video" | "link"; width: number | null; height: number | null; duration_ms: number | null; link_url: string | null; position: number; storage_path: string | null };
    const files = ((s.submission_files ?? []) as FileRow[]).sort((a, b) => a.position - b.position);
    const assets: ReviewAsset[] = [];
    for (const f of files) {
      let frames: Buffer[] = [];
      if (f.media_type !== "link") {
        const mine = stored.filter((o) => o.name.startsWith(`${f.id}-`)).map((o) => `${prefix}analysis/${o.name}`);
        frames = await Promise.all(mine.slice(0, 6).map((p) => download(admin, BUCKET_ORIGINALS, p)));
        if (!frames.length && f.media_type === "image" && f.storage_path) {
          frames = [await analysisJpeg(await download(admin, BUCKET_ORIGINALS, f.storage_path))];
        }
      }
      assets.push({ media_type: f.media_type, width: f.width, height: f.height, duration_ms: f.duration_ms, link_url: f.link_url, frames });
    }

    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    const input: ReviewInput = {
      campaign: {
        title: c.title, description: c.description, deliverables: c.deliverables, aspect_ratios: c.aspect_ratios ?? [],
        ai_disclosure_required: c.ai_disclosure_required, suggested_tools: c.suggested_tools ?? [],
        tools: ((c.campaign_tools ?? []) as { ai_tools: { name: string } | { name: string }[] | null }[])
          .map((t) => one(t.ai_tools)?.name).filter((n): n is string => !!n),
        style: one(c.styles as unknown as { name: string } | null)?.name ?? null,
        content_type: one(c.content_types as unknown as { name: string } | null)?.name ?? null,
      },
      guideline: g ? {
        primary_colors: g.primary_colors ?? [], secondary_colors: g.secondary_colors ?? [], fonts: g.fonts ?? [],
        tone_of_voice: g.tone_of_voice, visual_style: g.visual_style, dos: g.dos ?? [], donts: g.donts ?? [], restricted_content: g.restricted_content,
      } : null,
      submission: { version: s.version, notes: s.notes, tools_used: s.tools_used ?? [], workflow_notes: s.workflow_notes, ai_generated_declared: s.ai_generated_declared },
      assets,
      logo: await fetchLogo(g?.logo_url ?? null),
    };

    const result = await runReview(input, ai);
    const status = result.aiError ? "failed" : "done";
    await admin.from("ai_review_results").update({
      status, brand_match_score: result.score, checks: result.checks, insights: result.insights,
      model_name: result.model, error: result.aiError,
    }).eq("submission_id", submissionId);
    await log(admin, submissionId, "submission_review", status, result.aiError ?? `score ${result.score ?? "n/a"} via ${result.model ?? "deterministic checks only"}`, Date.now() - t0);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("ai_review_results").update({ status: "failed", error: message.slice(0, 1000) }).eq("submission_id", submissionId);
    await log(admin, submissionId, "submission_review", "failed", message, Date.now() - t0);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Licence record PDF
// ---------------------------------------------------------------------------
export async function issueCertificatePdf(admin: Admin, certificateId: string, siteUrl: string) {
  const { data: cert, error } = await admin.from("ip_certificates").select("*").eq("certificate_id", certificateId).single();
  if (error || !cert) throw new Error(error?.message ?? "Certificate not found");
  const t0 = Date.now();
  const pdf = await certificatePdf({
    certificate_id: cert.certificate_id,
    generated_at: cert.generated_at,
    terms: cert.terms,
    tools_declared: cert.tools_declared ?? [],
    asset_hashes: cert.asset_hashes ?? [],
    verify_url: `${siteUrl.replace(/\/$/, "")}/verify/${cert.certificate_id}`,
  } satisfies CertificateData);
  const path = `${cert.certificate_id}.pdf`;
  await upload(admin, BUCKET_CERTIFICATES, path, pdf, "application/pdf");
  await admin.from("ip_certificates").update({ pdf_path: path }).eq("id", cert.id);
  if (cert.submission_id) await log(admin, cert.submission_id, "certificate", "done", certificateId, Date.now() - t0);
  return { path, pdf };
}
