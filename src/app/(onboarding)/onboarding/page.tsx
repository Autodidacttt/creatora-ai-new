"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useDb, useMe } from "@/features/session";
import { useProfile } from "@/hooks/use-profile";
import { updateProfile } from "@/services/profiles";
import { GlassPanel } from "@/components/ui/glass";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { BasicsForm } from "@/components/profile/basics-form";
import { BrandDetailsForm, CreatorAttributesForm, CreatorDetailsForm } from "@/components/profile/creator-forms";
import { cn, errorMessage } from "@/lib/utils";

export default function OnboardingPage() {
  const me = useMe();
  const db = useDb();
  const router = useRouter();
  const profile = useProfile(me.username);
  const [step, setStep] = useState(0);
  const isCreator = me.role === "creator";
  const steps = isCreator
    ? [
        { title: "Your profile", body: "How brands and other creators will see you." },
        { title: "Skills & AI tools", body: "This powers search, filters and brief matching." },
        { title: "Experience & workflow", body: "Help brands understand how you work." },
      ]
    : [
        { title: "Brand profile", body: "How creators will see your brand." },
        { title: "Company details", body: "A little context for creators applying to your briefs." },
      ];

  async function finish() {
    try {
      await updateProfile(db, { onboarded: true });
      toast.success("You're all set!");
      // Brands go straight to their verification flow (they can finish it later from the profile)
      router.replace(isCreator ? `/posts/new?welcome=1` : "/verification?welcome=1");
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function next() {
    await profile.refetch();
    if (step < steps.length - 1) setStep(step + 1);
    else await finish();
  }

  return (
    <div>
      <p className="eyebrow">Welcome to Creatora</p>
      <h1 className="display mt-1 text-3xl sm:text-4xl">Let&apos;s set up your {isCreator ? "creator" : "brand"} profile</h1>

      <ol className="mt-6 flex gap-2" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-1 items-center gap-2">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
              i < step ? "bg-ink text-bg" : i === step ? "bg-amber text-on-amber" : "bg-ink/10 text-ink-3")}>
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:inline", i === step ? "font-semibold" : "text-ink-3")}>{s.title}</span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-line" />}
          </li>
        ))}
      </ol>

      <GlassPanel className="mt-6 p-5 sm:p-8">
        {profile.isPending && <Skeleton className="h-96" />}
        {profile.isError && <ErrorState error={profile.error} onRetry={() => profile.refetch()} />}
        {profile.data && (
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}>
              <h2 className="display text-xl">{steps[step].title}</h2>
              <p className="mb-6 text-sm text-ink-2">{steps[step].body}</p>
              {step === 0 && <BasicsForm profile={profile.data} onSaved={next} submitLabel="Continue" />}
              {step === 1 && isCreator && <CreatorAttributesForm profile={profile.data} onSaved={next} submitLabel="Continue" />}
              {step === 1 && !isCreator && <BrandDetailsForm profile={profile.data} onSaved={next} submitLabel="Finish setup" />}
              {step === 2 && isCreator && <CreatorDetailsForm profile={profile.data} onSaved={next} submitLabel="Finish setup" />}
            </motion.div>
          </AnimatePresence>
        )}
      </GlassPanel>
      {step > 0 && (
        <button onClick={() => setStep(step - 1)} className="mt-4 text-sm text-ink-2 underline-offset-4 hover:underline">← Back</button>
      )}
    </div>
  );
}
