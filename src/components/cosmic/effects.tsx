"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

/**
 * Visual-effects preference (Settings → Appearance): "full" | "reduced" | "off", persisted per browser.
 * The *effective* level is the user's choice capped by the OS reduced-motion setting, and is mirrored to
 * <html data-effects> (an inline script in the root layout sets it before first paint, see EFFECTS_SCRIPT).
 */
export type EffectsPref = "full" | "reduced" | "off";

const KEY = "creatora-effects";
const EVENT = "creatora-effects-change";
const RM = "(prefers-reduced-motion: reduce)";

/** Runs before first paint (root layout), so CSS keyed on data-effects never flashes. */
export const EFFECTS_SCRIPT = `try{var e=localStorage.getItem("${KEY}");if(e!=="reduced"&&e!=="off")e="full";if(e==="full"&&matchMedia("${RM}").matches)e="reduced";document.documentElement.dataset.effects=e}catch(_){}`;

function readPref(): EffectsPref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "reduced" || v === "off" ? v : "full";
  } catch {
    return "full";
  }
}

function effective(pref: EffectsPref, reducedMotion: boolean): EffectsPref {
  return pref === "full" && reducedMotion ? "reduced" : pref;
}

// Snapshot is "pref|level" so one string carries both and stays referentially stable.
function snapshot() {
  const pref = readPref();
  return `${pref}|${effective(pref, matchMedia(RM).matches)}`;
}
function subscribe(cb: () => void) {
  const mq = matchMedia(RM);
  mq.addEventListener("change", cb);
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

interface EffectsState {
  /** What the user picked */
  pref: EffectsPref;
  /** What actually runs (pref capped by prefers-reduced-motion) */
  level: EffectsPref;
  setPref: (p: EffectsPref) => void;
}

const Ctx = createContext<EffectsState>({ pref: "full", level: "full", setPref: () => {} });

export function EffectsProvider({ children }: { children: ReactNode }) {
  const snap = useSyncExternalStore(subscribe, snapshot, () => "full|full");
  const [pref, level] = snap.split("|") as [EffectsPref, EffectsPref];

  useEffect(() => {
    document.documentElement.dataset.effects = level;
  }, [level]);

  const setPref = useCallback((p: EffectsPref) => {
    try { localStorage.setItem(KEY, p); } catch { /* private mode: falls back to the default */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const value = useMemo(() => ({ pref, level, setPref }), [pref, level, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useEffects = () => useContext(Ctx);

/** True when rich pointer effects (magnetic, tilt, cursor glow) make sense: full effects and a precise pointer. */
export function useFinePointerFx() {
  const { level } = useEffects();
  const fine = useSyncExternalStore(
    (cb) => {
      const mq = matchMedia("(pointer: fine)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia("(pointer: fine)").matches,
    () => false,
  );
  return level === "full" && fine;
}
