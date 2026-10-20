// Server-side media processing for submissions: hashes, dimensions, palettes and WATERMARKED previews.
// Node only (sharp + ffmpeg). Never import from client components.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { extractPalette, type Swatch } from "./palette";

const FONT = path.join(process.cwd(), "src", "assets", "fonts", "Geist-Regular.ttf");

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------
async function text(markup: string, heightPx: number) {
  // Pango renders ~0.25px of glyph height per dpi at the default size; scale dpi to hit the target height.
  const dpi = Math.max(36, Math.round(heightPx * 6.2));
  const { data, info } = await sharp({ text: { text: markup, fontfile: FONT, font: "Geist", rgba: true, dpi } })
    .png().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** A transparent full-frame layer: diagonal repeated label + a solid "preview" badge in the corner. */
export async function watermarkLayer(width: number, height: number, label: string): Promise<Buffer> {
  const px = Math.max(12, Math.round(Math.min(width, height) / 20));
  const light = await text(`<span foreground="#FFFFFF" alpha="42%">${esc(label)}</span>`, px);
  const dark = await text(`<span foreground="#000000" alpha="28%">${esc(label)}</span>`, px);
  const shadow = Math.max(1, Math.round(px / 14));
  const gapX = Math.round(px * 1.6);
  const gapY = Math.round(px * 2.4);
  const tile = await sharp({
    create: { width: light.width + shadow + gapX, height: light.height + shadow + gapY, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: dark.data, left: shadow, top: shadow }, { input: light.data, left: 0, top: 0 }])
    .png().toBuffer();
  // Long labels on small frames: the rotated tile must never be larger than the frame (sharp rejects that)
  const rotatedFull = await sharp(tile).rotate(-28, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  const rotated = rotatedFull.info.width > width || rotatedFull.info.height > height
    ? await sharp(rotatedFull.data).resize(width, height, { fit: "inside" }).png().toBuffer()
    : rotatedFull.data;

  const badgeText = await text(`<span foreground="#FFFFFF" font_weight="bold">PREVIEW · NOT LICENSED</span>`, Math.max(10, Math.round(px * 0.55)));
  const padX = Math.round(badgeText.height * 0.9);
  const padY = Math.round(badgeText.height * 0.45);
  const badge = await sharp({
    create: { width: badgeText.width + padX * 2, height: badgeText.height + padY * 2, channels: 4, background: { r: 20, g: 18, b: 14, alpha: 0.72 } },
  }).composite([{ input: badgeText.data, left: padX, top: padY }]).png().toBuffer();
  const margin = Math.round(px * 0.6);

  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: rotated, tile: true, top: 0, left: 0 },
      ...(badgeText.width + padX * 2 + margin * 2 < width
        ? [{ input: badge, top: height - (badgeText.height + padY * 2) - margin, left: width - (badgeText.width + padX * 2) - margin }]
        : []),
    ])
    .png().toBuffer();
}

async function paletteOf(input: Buffer): Promise<Swatch[]> {
  const { data } = await sharp(input, { failOn: "none" }).resize(96, 96, { fit: "inside" }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return extractPalette(data, 4, 6);
}

/** Small un-watermarked JPEG for AI analysis (never stored or shown to the brand). */
export async function analysisJpeg(input: Buffer, max = 768): Promise<Buffer> {
  return sharp(input, { failOn: "none" }).rotate().resize(max, max, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
export interface ImageResult {
  preview: Buffer;
  width: number;
  height: number;
  palette: Swatch[];
}

export async function watermarkImage(input: Buffer, label: string, maxEdge = 1600): Promise<{ data: Buffer; width: number; height: number }> {
  const resized = await sharp(input, { failOn: "none" }).rotate()
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).toBuffer({ resolveWithObject: true });
  const { width, height } = resized.info;
  const layer = await watermarkLayer(width, height, label);
  const data = await sharp(resized.data).composite([{ input: layer }]).jpeg({ quality: 76, mozjpeg: true }).toBuffer();
  return { data, width, height };
}

export async function processImage(input: Buffer, label: string): Promise<ImageResult> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  const swap = (meta.orientation ?? 1) >= 5;
  const preview = await watermarkImage(input, label);
  return {
    preview: preview.data,
    width: (swap ? meta.height : meta.width) ?? preview.width,
    height: (swap ? meta.width : meta.height) ?? preview.height,
    palette: await paletteOf(input),
  };
}

// ---------------------------------------------------------------------------
// Video (ffmpeg when available; otherwise watermarked frames supplied by the uploader's browser)
// ---------------------------------------------------------------------------
export function ffmpegBinary(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require("ffmpeg-static") as string | null;
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function run(bin: string, args: string[], timeoutMs = 90_000): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, _stdout, stderr) => {
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0, stderr: String(stderr) });
    });
  });
}

export interface VideoResult {
  method: "video_ffmpeg" | "video_frames";
  preview: Buffer | null;         // watermarked low-res MP4 (ffmpeg only)
  frames: Buffer[];               // watermarked JPEG frames (also the poster: frames[0])
  analysisFrames: Buffer[];       // small un-watermarked frames for AI / palette (server only)
  width: number | null;
  height: number | null;
  durationMs: number | null;
  palette: Swatch[];
  note?: string;
}

async function framesFallback(clientFrames: Buffer[], label: string, meta: { width?: number; height?: number; durationMs?: number }, note: string): Promise<VideoResult> {
  const frames = await Promise.all(clientFrames.slice(0, 8).map(async (f) => (await watermarkImage(f, label, 1280)).data));
  const analysisFrames = await Promise.all(clientFrames.slice(0, 6).map((f) => analysisJpeg(f)));
  return {
    method: "video_frames", preview: null, frames, analysisFrames,
    width: meta.width ?? null, height: meta.height ?? null, durationMs: meta.durationMs ?? null,
    palette: analysisFrames.length ? await paletteOf(await stack(analysisFrames)) : [],
    note,
  };
}

/** Stacks frames vertically so one palette represents the whole clip. */
async function stack(frames: Buffer[]): Promise<Buffer> {
  const small = await Promise.all(frames.map((f) => sharp(f).resize(160, 90, { fit: "cover" }).png().toBuffer()));
  return sharp({ create: { width: 160, height: 90 * small.length, channels: 3, background: "#000" } })
    .composite(small.map((input, i) => ({ input, top: i * 90, left: 0 })))
    .png().toBuffer();
}

export async function processVideo(
  input: Buffer, ext: string, label: string,
  clientFrames: Buffer[] = [], clientMeta: { width?: number; height?: number; durationMs?: number } = {},
): Promise<VideoResult> {
  const bin = ffmpegBinary();
  if (!bin) return framesFallback(clientFrames, label, clientMeta, "ffmpeg isn't available on this server");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "creatora-"));
  try {
    const src = path.join(dir, `in.${ext.replace(/[^a-z0-9]/gi, "") || "mp4"}`);
    await fs.writeFile(src, input);
    const probe = await run(bin, ["-hide_banner", "-i", src]);
    const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr);
    const size = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(probe.stderr);
    const rot = /rotation of (-?\d+)|rotate\s*:\s*(-?\d+)/.exec(probe.stderr);
    const durationMs = dur ? Math.round((+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) * 1000) : clientMeta.durationMs ?? null;
    let width = size ? +size[1] : clientMeta.width ?? null;
    let height = size ? +size[2] : clientMeta.height ?? null;
    if (rot && Math.abs(+(rot[1] ?? rot[2])) % 180 === 90 && width && height) [width, height] = [height, width];
    if (!width || !height) return framesFallback(clientFrames, label, clientMeta, "couldn't read the video stream");

    // Sample 6 frames across the clip
    const seconds = (durationMs ?? 6000) / 1000;
    const times = Array.from({ length: 6 }, (_, i) => Math.max(0, seconds * (0.05 + (0.9 * i) / 5)));
    const raw: Buffer[] = [];
    for (const [i, t] of times.entries()) {
      const out = path.join(dir, `f${i}.jpg`);
      const r = await run(bin, ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "3", "-y", out], 30_000);
      if (r.code === 0 && existsSync(out)) raw.push(await fs.readFile(out));
    }
    if (!raw.length) return framesFallback(clientFrames, label, clientMeta, "ffmpeg couldn't extract frames");

    // Low-res watermarked preview (long edge 960, even dimensions)
    const landscape = width >= height;
    const pw = landscape ? 960 : Math.round((960 * width) / height / 2) * 2;
    const ph = landscape ? Math.round((960 * height) / width / 2) * 2 : 960;
    const wm = path.join(dir, "wm.png");
    await fs.writeFile(wm, await watermarkLayer(pw, ph, label));
    const outVideo = path.join(dir, "preview.mp4");
    const enc = await run(bin, [
      "-hide_banner", "-loglevel", "error", "-i", src, "-i", wm,
      "-filter_complex", `[0:v]scale=${pw}:${ph},setsar=1[v];[v][1:v]overlay=0:0[out]`,
      "-map", "[out]", "-map", "0:a?", "-t", "180",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-c:a", "aac", "-b:a", "96k", "-y", outVideo,
    ], 150_000);
    const preview = enc.code === 0 && existsSync(outVideo) ? await fs.readFile(outVideo) : null;

    const frames = await Promise.all(raw.map(async (f) => (await watermarkImage(f, label, 1280)).data));
    const analysisFrames = await Promise.all(raw.map((f) => analysisJpeg(f)));
    return {
      method: preview ? "video_ffmpeg" : "video_frames",
      preview, frames, analysisFrames, width, height, durationMs,
      palette: await paletteOf(await stack(analysisFrames)),
      note: preview ? undefined : "ffmpeg couldn't encode a preview; showing watermarked frames",
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
