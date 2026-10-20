"use client";
/* eslint-disable @next/next/no-img-element -- short-lived signed URLs from private storage */

import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Film, ImageIcon, Link2, Pause, Play, ShieldCheck } from "lucide-react";
import type { SubmissionFile } from "@/types/workspace";
import { useDb } from "@/features/session";
import { signPreviews } from "@/services/workspace";
import { Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/utils";

export const previewPaths = (f: Pick<SubmissionFile, "preview_path" | "thumbnail_path" | "frame_paths">) =>
  [f.preview_path, f.thumbnail_path, ...(f.frame_paths ?? [])].filter((p): p is string => !!p);

/** Short-lived signed URLs for watermarked previews (storage RLS decides who may sign them). */
export function useSignedPreviews(paths: string[]) {
  const db = useDb();
  const key = [...new Set(paths)].sort();
  return useQuery({
    queryKey: ["signed-previews", key],
    queryFn: () => signPreviews(db, key),
    enabled: key.length > 0,
    staleTime: 8 * 60_000,
    refetchInterval: 9 * 60_000,
  });
}

export const PREVIEW_METHOD: Record<string, string> = {
  image_watermark: "Watermarked server-side · low-resolution preview",
  video_ffmpeg: "Watermark burned into a low-res video (server-side ffmpeg)",
  video_frames: "Watermarked still frames + overlay — server-side video transcoding wasn't available for this file",
  external_link: "External link shared by the creator — not hosted or watermarked by Creatora",
};

/** CSS overlay on top of (already watermarked) previews — a second, visible layer for video players. */
function OverlayMark() {
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='260' height='120'><text x='0' y='70' transform='rotate(-24 130 60)' fill='white' fill-opacity='0.28' font-family='sans-serif' font-size='18' font-weight='600'>CREATORA · PREVIEW</text></svg>`,
  );
  return <div aria-hidden className="pointer-events-none absolute inset-0 select-none" style={{ backgroundImage: `url("data:image/svg+xml,${svg}")` }} />;
}

function FramePlayer({ urls, label }: { urls: string[]; label: string }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || urls.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % urls.length), 1200);
    return () => clearInterval(t);
  }, [playing, urls.length]);
  if (!urls.length) return null;
  return (
    <div className="relative">
      <img src={urls[i]} alt={`${label} — frame ${i + 1} of ${urls.length}`} className="mx-auto max-h-[68vh] w-full rounded-2xl object-contain" draggable={false} />
      <OverlayMark />
      <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-2">
        <div className="glass-strong flex items-center gap-1 rounded-full p-1">
          <button type="button" aria-label="Previous frame" onClick={() => setI((x) => (x - 1 + urls.length) % urls.length)} className="grid size-8 place-items-center rounded-full hover:bg-ink/5"><ChevronLeft className="size-4" /></button>
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)} className="grid size-8 place-items-center rounded-full hover:bg-ink/5">{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
          <span className="px-1 text-xs tabular-nums text-ink-2">{i + 1}/{urls.length}</span>
          <button type="button" aria-label="Next frame" onClick={() => setI((x) => (x + 1) % urls.length)} className="grid size-8 place-items-center rounded-full hover:bg-ink/5"><ChevronRight className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}

export const PreviewViewer = forwardRef<HTMLVideoElement, {
  file: SubmissionFile;
  urls: Record<string, string> | undefined;
  className?: string;
  onTime?: (ms: number) => void;
}>(function PreviewViewer({ file, urls, className, onTime }, ref) {
  const label = file.file_name ?? "Submitted work";
  let body: ReactNode;
  if (file.media_type === "link" || file.preview_kind === "external_link") {
    body = (
      <a href={file.link_url ?? "#"} target="_blank" rel="noopener noreferrer nofollow"
        className="flex items-center gap-3 rounded-2xl border border-line bg-card p-4 text-sm hover:bg-ink/[0.03]">
        <span className="grid size-10 place-items-center rounded-xl bg-amber-soft"><Link2 className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{file.link_url}</span><span className="text-xs text-ink-3">Opens the creator&apos;s link in a new tab</span></span>
        <ExternalLink className="size-4 text-ink-3" />
      </a>
    );
  } else if (!urls) {
    body = <Skeleton className="aspect-video w-full rounded-2xl" />;
  } else if (file.preview_kind === "video_ffmpeg" && file.preview_path && urls[file.preview_path]) {
    body = (
      <div className="relative" onContextMenu={(e) => e.preventDefault()}>
        <video ref={ref} src={urls[file.preview_path]} poster={file.thumbnail_path ? urls[file.thumbnail_path] : undefined}
          controls playsInline controlsList="nodownload noremoteplayback" disablePictureInPicture
          onTimeUpdate={(e) => onTime?.(Math.round(e.currentTarget.currentTime * 1000))}
          className="mx-auto max-h-[68vh] w-full rounded-2xl bg-black" aria-label={label} />
        <OverlayMark />
      </div>
    );
  } else if (file.preview_kind === "video_frames") {
    body = <FramePlayer urls={file.frame_paths.map((p) => urls[p]).filter(Boolean)} label={label} />;
  } else if (file.preview_path && urls[file.preview_path]) {
    body = (
      <div className="relative" onContextMenu={(e) => e.preventDefault()}>
        <img src={urls[file.preview_path]} alt={label} className="mx-auto max-h-[68vh] w-full rounded-2xl object-contain" draggable={false} />
      </div>
    );
  } else {
    body = <p className="rounded-2xl bg-ink/[0.04] p-6 text-center text-sm text-ink-2">Preview unavailable.</p>;
  }
  return (
    <figure className={cn("space-y-2", className)}>
      {body}
      {file.preview_kind && (
        <figcaption className="flex items-start gap-1.5 text-[11px] text-ink-3">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {PREVIEW_METHOD[file.preview_kind]}
        </figcaption>
      )}
    </figure>
  );
});

/** Small square cover for lists and cards. */
export function MediaThumb({ mediaType, path, urls, className, alt = "" }: {
  mediaType: "image" | "video" | "link" | undefined;
  path: string | null | undefined;
  urls: Record<string, string> | undefined;
  className?: string;
  alt?: string;
}) {
  const src = path ? urls?.[path] : undefined;
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-xl bg-ink/[0.06] text-ink-3", className)}>
      {src ? <img src={src} alt={alt} className="size-full object-cover" draggable={false} />
        : mediaType === "link" ? <Link2 className="size-5" /> : mediaType === "video" ? <Film className="size-5" /> : <ImageIcon className="size-5" />}
      {mediaType === "video" && src && <span className="absolute bottom-1 right-1 grid size-5 place-items-center rounded-full bg-black/55 text-white"><Play className="size-3" /></span>}
    </span>
  );
}
