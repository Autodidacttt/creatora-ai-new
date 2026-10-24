"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Sparkles } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass";
import { SegmentedTabs } from "@/components/ui/tabs";
import { useEffects, type EffectsPref } from "./effects";

const EFFECT_HINT: Record<EffectsPref, string> = {
  full: "Drifting starfield, glows, parallax and smooth scrolling on the landing page.",
  reduced: "A still starfield and simple fades. No parallax, tilt or smooth scrolling.",
  off: "No background effects or decorative motion. Plain night-sky (or paper) surfaces.",
};

const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

/** Settings → Appearance: theme and the persisted "Reduce effects" preference (this browser only). */
export function AppearanceSettings() {
  const { pref, level, setPref } = useEffects();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const capped = pref === "full" && level === "reduced";

  return (
    <GlassPanel id="appearance" className="scroll-mt-24 space-y-5 p-5 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-amber-soft text-ink ring-1 ring-amber/30"><Sparkles className="size-4" /></span>
        <div>
          <h2 className="display text-xl">Appearance</h2>
          <p className="text-sm text-ink-2">Saved in this browser.</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Theme</p>
        <SegmentedTabs
          size="sm"
          value={mounted ? ((theme ?? "dark") as "system" | "light" | "dark") : "dark"}
          onChange={setTheme}
          items={[{ value: "dark", label: "Night" }, { value: "light", label: "Paper" }, { value: "system", label: "System" }]}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Effects</p>
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
      </div>
    </GlassPanel>
  );
}
