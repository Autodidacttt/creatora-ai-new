/* eslint-disable @next/next/no-img-element */
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Link2, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { AspectRatio, PostCard } from "@/types/app";
import { useDb, useMe } from "@/features/session";
import { useLookups } from "@/hooks/use-lookups";
import { postSchema } from "@/lib/validation/schemas";
import { createPost, detectEmbed, updatePost } from "@/services/posts";
import { uploadToBucket } from "@/services/profiles";
import { ASPECT_RATIOS } from "@/config/constants";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/multi-select";
import { ToggleChip, Chip } from "@/components/ui/chip";
import { Switch } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { PillCTA } from "@/components/ui/pill-cta";
import { GlassPanel } from "@/components/ui/glass";
import { Skeleton } from "@/components/ui/states";
import { aspectClass, cn, errorMessage } from "@/lib/utils";

const MAX_MB = 50;
const RATIOS: [AspectRatio, number][] = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5], ["4:3", 4 / 3], ["21:9", 21 / 9]];
const nearestRatio = (w: number, h: number): AspectRatio =>
  RATIOS.reduce((best, r) => (Math.abs(r[1] - w / h) < Math.abs(best[1] - w / h) ? r : best))[0];

/** Grabs a frame from a local video file to use as its thumbnail. */
async function videoFrame(file: File): Promise<{ blob: Blob | null; w: number; h: number }> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => { video.currentTime = Math.min(0.5, video.duration / 2 || 0); };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      canvas.toBlob((blob) => resolve({ blob, w: video.videoWidth, h: video.videoHeight }), "image/jpeg", 0.85);
    };
    video.onerror = () => resolve({ blob: null, w: 16, h: 9 });
  });
}

type Step = { tool_id: number | null; step: string };

export function PostForm({ post }: { post?: PostCard }) {
  const db = useDb();
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const lookups = useLookups();
  const fileInput = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState<"upload" | "link">(post?.media_type === "embed" ? "link" : "upload");
  const [media, setMedia] = useState({
    media_type: post?.media_type ?? ("image" as PostCard["media_type"]),
    media_url: post?.media_url ?? null as string | null,
    thumbnail_url: post?.thumbnail_url ?? null as string | null,
    source_link: post?.source_link ?? "",
    embed_provider: post?.embed_provider ?? null as PostCard["embed_provider"],
  });
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState(post?.title ?? "");
  const [description, setDescription] = useState(post?.description ?? "");
  const [toolIds, setToolIds] = useState<number[]>(post?.tools.map((t) => t.id) ?? []);
  const [steps, setSteps] = useState<Step[]>(post?.workflow_steps.map((s) => ({ tool_id: s.tool_id, step: s.step })) ?? []);
  const [notes, setNotes] = useState(post?.workflow_notes ?? "");
  const [contentType, setContentType] = useState<number | null>(post?.content_type?.id ?? null);
  const [style, setStyle] = useState<number | null>(post?.style?.id ?? null);
  const [category, setCategory] = useState<number | null>(post?.category?.id ?? null);
  const [aspect, setAspect] = useState<AspectRatio>(post?.aspect_ratio ?? "16:9");
  const [commercial, setCommercial] = useState(post?.commercial_use_cleared ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const isVideo = file.type.startsWith("video/");
    if (!isVideo && !file.type.startsWith("image/")) return toast.error("Upload an image or a video");
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`Files must be under ${MAX_MB} MB`);
    setUploading(true);
    try {
      if (isVideo) {
        const frame = await videoFrame(file);
        const [url, thumb] = await Promise.all([
          uploadToBucket(db, "post-media", file),
          frame.blob ? uploadToBucket(db, "post-media", new File([frame.blob], "thumb.jpg", { type: "image/jpeg" })) : Promise.resolve(null),
        ]);
        setMedia({ media_type: "video", media_url: url, thumbnail_url: thumb, source_link: "", embed_provider: null });
        setAspect(nearestRatio(frame.w, frame.h));
      } else {
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 16, h: 9 });
          img.src = URL.createObjectURL(file);
        });
        const url = await uploadToBucket(db, "post-media", file);
        setMedia({ media_type: "image", media_url: url, thumbnail_url: null, source_link: "", embed_provider: null });
        setAspect(nearestRatio(dims.w, dims.h));
      }
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120));
    } catch (e) {
      toast.error(errorMessage(e, "Upload failed"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onLink(url: string) {
    const embed = detectEmbed(url);
    setMedia((m) => ({ ...m, media_type: "embed", media_url: null, source_link: url, embed_provider: embed.provider, thumbnail_url: embed.thumbnail ?? m.thumbnail_url }));
    if (embed.provider === "instagram" || embed.provider === "tiktok") setAspect("9:16");
    if (!embed.provider) return;
    try {
      const res = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      const data = (await res.json()) as { title: string | null; thumbnail_url: string | null };
      if (data.thumbnail_url) setMedia((m) => ({ ...m, thumbnail_url: data.thumbnail_url }));
      if (data.title && !title) setTitle(data.title.slice(0, 120));
    } catch {
      /* preview is a nicety; the link still works */
    }
  }

  async function submit() {
    const values = {
      title,
      description,
      ...media,
      source_link: media.source_link || null,
      content_type_id: contentType,
      style_id: style,
      category_id: category,
      aspect_ratio: aspect,
      commercial_use_cleared: commercial,
      workflow_notes: notes,
      workflow_steps: steps.filter((s) => s.step.trim()),
      tool_ids: toolIds,
    };
    const parsed = postSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      toast.error("Check the highlighted fields");
      return;
    }
    if (source === "link" && !media.source_link) return setErrors({ media_url: "Paste a link to your work" });
    setErrors({});
    setSaving(true);
    try {
      const { tool_ids, ...rest } = parsed.data;
      const id = post ? (await updatePost(db, post.id, rest, tool_ids), post.id) : await createPost(db, rest, tool_ids);
      qc.invalidateQueries({ queryKey: ["creator-posts"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["post", id] });
      toast.success(post ? "Changes saved" : "Added to your portfolio");
      router.push(`/u/${me.username}?post=${id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  }

  if (lookups.isPending) return <Skeleton className="h-[40rem] rounded-[2rem]" />;
  const L = lookups.data;
  if (!L) return <p className="text-danger">Couldn&apos;t load form options. Refresh to try again.</p>;
  const toolName = (id: number | null) => L.ai_tools.find((t) => t.id === id)?.name;
  const preview = media.thumbnail_url ?? (media.media_type === "image" ? media.media_url : null);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Media */}
      <GlassPanel className="h-fit space-y-4 p-5 lg:sticky lg:top-24">
        <div className="flex gap-2">
          <ToggleChip selected={source === "upload"} onClick={() => setSource("upload")}><span className="flex items-center gap-1.5"><Upload className="size-3.5" /> Upload</span></ToggleChip>
          <ToggleChip selected={source === "link"} onClick={() => setSource("link")}><span className="flex items-center gap-1.5"><Link2 className="size-3.5" /> Paste a link</span></ToggleChip>
        </div>
        {source === "upload" ? (
          <>
            <input ref={fileInput} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
              className={cn("relative grid w-full place-items-center overflow-hidden rounded-[1.5rem] border-2 border-dashed border-line bg-card transition-colors hover:border-amber",
                media.media_url && media.media_type !== "embed" ? aspectClass(aspect) : "aspect-video")}
            >
              {uploading ? (
                <span className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" /> Uploading…</span>
              ) : media.media_url && media.media_type === "video" ? (
                <video src={media.media_url} className="size-full object-cover" muted autoPlay loop playsInline />
              ) : preview && media.media_type === "image" ? (
                <img src={preview} alt="" className="size-full object-cover" />
              ) : (
                <span className="px-6 text-center text-sm text-ink-2">
                  <Upload className="mx-auto mb-2 size-6" />
                  Drop an image or video, or click to browse<br /><span className="text-xs text-ink-3">PNG, JPG, WEBP, GIF, MP4, WEBM · up to {MAX_MB} MB</span>
                </span>
              )}
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <Input type="url" placeholder="https://youtube.com/watch?v=… · vimeo · instagram · behance · tiktok" value={media.source_link}
              onChange={(e) => setMedia((m) => ({ ...m, source_link: e.target.value }))}
              onBlur={(e) => e.target.value && onLink(e.target.value.trim())} aria-label="Link to your work" />
            {media.embed_provider && <Chip tone="amber" className="capitalize">Detected: {media.embed_provider}</Chip>}
            <div className={cn("overflow-hidden rounded-[1.5rem] bg-card", aspectClass(aspect))}>
              {preview ? <img src={preview} alt="" className="size-full object-cover" /> : (
                <div className="grid size-full place-items-center px-6 text-center text-xs text-ink-3">Preview appears here. For links without a thumbnail, add a cover image below.</div>
              )}
            </div>
            <Button size="sm" onClick={() => fileInput.current?.click()}><Upload /> {media.thumbnail_url ? "Replace cover" : "Add cover image"}</Button>
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { const url = await uploadToBucket(db, "post-media", f); setMedia((m) => ({ ...m, thumbnail_url: url })); }
              catch (err) { toast.error(errorMessage(err)); }
            }} />
          </div>
        )}
        {errors.media_url && <p role="alert" className="text-xs text-danger">{errors.media_url}</p>}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Format / aspect ratio</legend>
          <div className="flex flex-wrap gap-1.5">
            {ASPECT_RATIOS.filter((a) => a.value !== "custom").map((a) => (
              <ToggleChip key={a.value} selected={aspect === a.value} onClick={() => setAspect(a.value)}>{a.label}</ToggleChip>
            ))}
          </div>
        </fieldset>
      </GlassPanel>

      {/* Details */}
      <GlassPanel className="space-y-5 p-5 sm:p-7">
        <Field label="Title" htmlFor="title" error={errors.title}>
          <Input id="title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="desc" optional hint="Concept, client, what makes it interesting">
          <Textarea id="desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="AI tools & models used" error={errors.tool_ids}>
          <MultiSelect label="Tools" options={L.ai_tools.map((t) => ({ value: t.id, label: t.name, group: t.category }))} value={toolIds} onChange={setToolIds} placeholder="Which tools made this?" />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Workflow <span className="text-xs font-normal text-ink-3">ordered steps — e.g. Midjourney → Runway → DaVinci</span></legend>
          {steps.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-2xl bg-card p-2 sm:flex-nowrap">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-amber text-xs font-bold text-on-amber">{i + 1}</span>
              <Select aria-label={`Step ${i + 1} tool`} className="h-9 sm:w-44" value={s.tool_id ?? ""} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, tool_id: e.target.value ? Number(e.target.value) : null } : x)))}>
                <option value="">Manual / other</option>
                {(toolIds.length ? L.ai_tools.filter((t) => toolIds.includes(t.id)) : L.ai_tools).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <Input aria-label={`Step ${i + 1} description`} className="h-9 min-w-0 flex-1" maxLength={120} placeholder="What happened in this step" value={s.step}
                onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)))} />
              <div className="flex">
                <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => setSteps(steps.map((x, j) => (j === i - 1 ? steps[i] : j === i ? steps[i - 1] : x)))}><ArrowUp /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => setSteps(steps.map((x, j) => (j === i + 1 ? steps[i] : j === i ? steps[i + 1] : x)))}><ArrowDown /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            </div>
          ))}
          {steps.length < 12 && (
            <Button size="sm" onClick={() => setSteps([...steps, { tool_id: toolIds[steps.length] ?? null, step: "" }])}><Plus /> Add step</Button>
          )}
          {steps.length > 0 && (
            <p className="text-xs text-ink-3">Preview: {steps.map((s) => toolName(s.tool_id) ?? "Manual").join(" → ")}</p>
          )}
        </fieldset>
        <Field label="Workflow notes" htmlFor="notes" optional hint="Consistency tricks, provenance, licensing of inputs…">
          <Textarea id="notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Content type" htmlFor="ct">
            <Select id="ct" value={contentType ?? ""} onChange={(e) => setContentType(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose…</option>
              {L.content_types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Style" htmlFor="style">
            <Select id="style" value={style ?? ""} onChange={(e) => setStyle(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose…</option>
              {L.styles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="Category" htmlFor="cat">
            <Select id="cat" value={category ?? ""} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose…</option>
              {L.categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
        </div>

        <label className="flex items-start justify-between gap-4 rounded-2xl bg-card p-4">
          <span>
            <span className="block text-sm font-medium">Cleared for commercial use</span>
            <span className="block text-xs text-ink-3">You own or have licensed every input (models, references, music) and the tools&apos; terms allow commercial use.</span>
          </span>
          <Switch checked={commercial} onCheckedChange={setCommercial} label="Cleared for commercial use" />
        </label>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => router.back()}><X /> Cancel</Button>
          <PillCTA onClick={submit} loading={saving} disabled={uploading}>{post ? "Save changes" : "Publish to portfolio"}</PillCTA>
        </div>
      </GlassPanel>
    </div>
  );
}
