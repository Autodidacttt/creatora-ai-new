/* eslint-disable @next/next/no-img-element */
"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useDb } from "@/features/session";
import { uploadToBucket } from "@/services/profiles";
import { Avatar } from "@/components/ui/avatar";
import { cn, errorMessage } from "@/lib/utils";

const MAX_MB = 5;

/** Uploads an image to Supabase Storage under the user's own folder and returns its public URL. */
export function ImageUpload({ value, onChange, name, variant }: {
  value: string | null;
  onChange: (url: string | null) => void;
  name: string;
  variant: "avatar" | "cover";
}) {
  const db = useDb();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Choose an image file");
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(`Images must be under ${MAX_MB} MB`);
    setBusy(true);
    try {
      onChange(await uploadToBucket(db, variant === "avatar" ? "avatars" : "post-media", file));
    } catch (e) {
      toast.error(errorMessage(e, "Upload failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className={cn(variant === "cover" && "w-full")}>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => handle(e.target.files?.[0])} />
      {variant === "avatar" ? (
        <button type="button" onClick={() => input.current?.click()} className="group relative rounded-full" aria-label="Change profile photo">
          <Avatar src={value} name={name} size="xl" />
          <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="group relative block h-28 w-full overflow-hidden rounded-3xl border border-dashed border-line bg-card"
          aria-label="Change cover image"
        >
          {value ? <img src={value} alt="" className="size-full object-cover" /> : (
            <span className="flex size-full items-center justify-center gap-2 text-sm text-ink-3"><ImagePlus className="size-4" /> Add a cover image</span>
          )}
          {busy && <span className="absolute inset-0 grid place-items-center bg-black/30"><Loader2 className="size-6 animate-spin text-white" /></span>}
        </button>
      )}
    </div>
  );
}
