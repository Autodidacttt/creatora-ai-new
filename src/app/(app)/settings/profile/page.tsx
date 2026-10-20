"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useMe } from "@/features/session";
import { useProfile } from "@/hooks/use-profile";
import { GlassPanel } from "@/components/ui/glass";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { SegmentedTabs } from "@/components/ui/tabs";
import { BasicsForm } from "@/components/profile/basics-form";
import { BrandDetailsForm, CreatorAttributesForm, CreatorDetailsForm, ExperienceManager } from "@/components/profile/creator-forms";

type Tab = "profile" | "skills" | "details" | "experience" | "company";

export default function EditProfilePage() {
  const me = useMe();
  const router = useRouter();
  const profile = useProfile(me.username);
  const [tab, setTab] = useState<Tab>("profile");
  const tabs: { value: Tab; label: string }[] =
    me.role === "creator"
      ? [
          { value: "profile", label: "Profile" },
          { value: "skills", label: "Skills & tools" },
          { value: "details", label: "Experience & rates" },
          { value: "experience", label: "Past work" },
        ]
      : [
          { value: "profile", label: "Profile" },
          { value: "company", label: "Company" },
        ];

  const refresh = () => { profile.refetch(); router.refresh(); };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/u/${me.username}`} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Back to profile
      </Link>
      <h1 className="display text-3xl">Edit profile</h1>
      <SegmentedTabs value={tab} onChange={setTab} items={tabs} />
      <GlassPanel className="p-5 sm:p-8">
        {profile.isPending && <Skeleton className="h-96" />}
        {profile.isError && <ErrorState error={profile.error} onRetry={() => profile.refetch()} />}
        {profile.data && (
          <div key={`${tab}-${profile.dataUpdatedAt}`}>
            {tab === "profile" && <BasicsForm profile={profile.data} onSaved={refresh} />}
            {tab === "skills" && <CreatorAttributesForm profile={profile.data} onSaved={refresh} />}
            {tab === "details" && <CreatorDetailsForm profile={profile.data} onSaved={refresh} />}
            {tab === "experience" && <ExperienceManager profile={profile.data} onChanged={refresh} />}
            {tab === "company" && <BrandDetailsForm profile={profile.data} onSaved={refresh} />}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
