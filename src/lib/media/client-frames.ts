// Browser-only: samples frames from a local video file so the server has watermarkable stills even when it
// can't transcode the video. Also returns basic metadata. Never throws — returns what it could read.

export interface VideoProbe {
  frames: Blob[];
  width?: number;
  height?: number;
  duration_ms?: number;
}

export async function sampleVideoFrames(file: File, count = 6, maxWidth = 960): Promise<VideoProbe> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  const once = (ev: string, timeoutMs = 8000) => new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    video.addEventListener(ev, () => { clearTimeout(t); resolve(true); }, { once: true });
    video.addEventListener("error", () => { clearTimeout(t); resolve(false); }, { once: true });
  });
  try {
    if (!(await once("loadeddata"))) return { frames: [] };
    const width = video.videoWidth, height = video.videoHeight;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const meta = { width: width || undefined, height: height || undefined, duration_ms: duration ? Math.round(duration * 1000) : undefined };
    if (!width || !height || !duration) return { frames: [], ...meta };

    const scale = Math.min(1, maxWidth / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { frames: [], ...meta };

    const frames: Blob[] = [];
    for (let i = 0; i < count; i++) {
      video.currentTime = Math.min(duration - 0.05, duration * (0.05 + (0.9 * i) / Math.max(1, count - 1)));
      if (!(await once("seeked", 5000))) break;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
      if (blob) frames.push(blob);
    }
    return { frames, ...meta };
  } catch {
    return { frames: [] };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/** Reads pixels from an image file (for logo palette suggestions). */
export async function imagePixels(file: File | string, size = 96): Promise<Uint8ClampedArray | null> {
  const url = typeof file === "string" ? file : URL.createObjectURL(file);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return null;
  } finally {
    if (typeof file !== "string") URL.revokeObjectURL(url);
  }
}
