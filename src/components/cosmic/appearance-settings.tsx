"use client";

import { useSyncExternalStore } from "react";
import { Sparkles } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass";
import { SegmentedTabs } from "@/components/ui/tabs";
import { useEffects, type EffectsPref } from "./effects";

const EFFECT_HINT: Record<EffectsPref, string> = {
  full: "Drifting starfield, shooting stars, app-open animations, glows and the animated landing story.",
  reduced: "A still starfield and simple fades. No shooting stars, parallax, tilt or grow-from-icon transitions.",
  off: "No background effects or decorative motion.",
};

const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

/** Settings → Effects: the persisted "Reduce effects" preference (this browser only). */
export function AppearanceSettings() {
  const { pref, level, setPref } = useEffects();
  const mounted = useMounted();
  const capped = pref === "full" && level === "reduced";

  return (
    <GlassPanel id="effects" className="scroll-mt-24 space-y-4 p-5 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-amber-soft text-ink ring-1 ring-amber/30"><Sparkles className="size-4" /></span>
        <div>
          <h2 className="display text-xl">Effects</h2>
          <p className="text-sm text-ink-2">Saved in this browser.</p>
        </div>
      </div>
      <SegmentedTabs
        size="sm"
        value={mounted ? pref : "full"}
        onChange={setPref}
        items={[{ value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }, { value: "off", label: "Off" }]}
      />
      <p className="text-xs text-ink-3" aria-live="polite">
        {EFFECT_HINT[mounted ? pref : "full"]}
        {mounted && capped && " Your device asks for reduced motion, so effects run in reduced mode."}
      </p>
    </GlassPanel>
  );
}
