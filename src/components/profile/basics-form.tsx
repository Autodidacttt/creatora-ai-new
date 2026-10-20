"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { FullProfile } from "@/types/app";
import { useDb } from "@/features/session";
import { profileSchema } from "@/lib/validation/schemas";
import { updateProfile } from "@/services/profiles";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/utils";
import { ImageUpload } from "./image-upload";

const LINK_FIELDS = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "behance", label: "Behance" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "vimeo", label: "Vimeo" },
];

export function BasicsForm({ profile, onSaved, submitLabel = "Save profile", extraValues }: {
  profile: FullProfile;
  onSaved?: () => void;
  submitLabel?: string;
  extraValues?: { onboarded?: boolean };
}) {
  const db = useDb();
  const [v, setV] = useState({
    display_name: profile.display_name,
    username: profile.username,
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    location: profile.location ?? "",
    website: profile.website ?? "",
    links: { ...(profile.links ?? {}) } as Record<string, string>,
    avatar_url: profile.avatar_url,
    cover_url: profile.cover_url,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((s) => ({ ...s, [k]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const links = Object.fromEntries(Object.entries(v.links).filter(([, url]) => url.trim()));
    const parsed = profileSchema.safeParse({ ...v, links });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      await updateProfile(db, { ...parsed.data, avatar_url: v.avatar_url, cover_url: v.cover_url, ...extraValues });
      toast.success("Profile saved");
      onSaved?.();
    } catch (err) {
      const msg = errorMessage(err);
      if (msg.toLowerCase().includes("username")) setErrors({ username: msg });
      else toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <ImageUpload variant="avatar" value={v.avatar_url} name={v.display_name} onChange={(url) => set("avatar_url", url)} />
        <ImageUpload variant="cover" value={v.cover_url} name={v.display_name} onChange={(url) => set("cover_url", url)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" htmlFor="display_name" error={errors.display_name}>
          <Input id="display_name" value={v.display_name} onChange={(e) => set("display_name", e.target.value)} />
        </Field>
        <Field label="Username" htmlFor="username" error={errors.username} hint="creatora.ai/u/your-name">
          <Input id="username" value={v.username} onChange={(e) => set("username", e.target.value.toLowerCase())} />
        </Field>
      </div>
      <Field label="Headline" htmlFor="headline" error={errors.headline} optional hint="One line: what you make, for whom">
        <Input id="headline" maxLength={140} value={v.headline} onChange={(e) => set("headline", e.target.value)}
          placeholder={profile.role === "brand" ? "e.g. Independent fashion label · Paris" : "e.g. AI filmmaker · narrative shorts & brand films"} />
      </Field>
      <Field label="Bio" htmlFor="bio" error={errors.bio} optional>
        <Textarea id="bio" maxLength={1200} value={v.bio} onChange={(e) => set("bio", e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Location" htmlFor="location" error={errors.location} optional>
          <Input id="location" value={v.location} onChange={(e) => set("location", e.target.value)} placeholder="City, Country" />
        </Field>
        <Field label="Website" htmlFor="website" error={errors.website} optional>
          <Input id="website" type="url" value={v.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Social links <span className="text-xs font-normal text-ink-3">optional</span></legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {LINK_FIELDS.map((l) => (
            <Input
              key={l.key}
              aria-label={l.label}
              placeholder={`${l.label} URL`}
              value={v.links[l.key] ?? ""}
              onChange={(e) => set("links", { ...v.links, [l.key]: e.target.value })}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving}>{submitLabel}</Button>
      </div>
    </form>
  );
}
