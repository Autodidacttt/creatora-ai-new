"use client";

import { useEffect, useState, ViewTransition, type ReactNode } from "react";
import { motion } from "motion/react";
import { OPEN, SPRING } from "@/lib/motion";
import { useEffects } from "./effects";

/**
 * iPhone-style "app open": a page grows out of the icon, card or row that was pressed.
 *
 * - <AppOpenTracker/> (mounted once) records, at click time, where the pressed internal link sits relative to the
 *   current page root, and mirrors it into CSS variables (--open-x/-y/-clip) for the View Transition.
 * - <PageTransition/> (the route templates) consumes it on mount:
 *     • View Transitions supported → React <ViewTransition enter="app-open"> + CSS keyframes in globals.css
 *     • otherwise → the same motion with a Framer spring.
 *   Entry-only (no exit animations), never blocks navigation or fetching, no animation on hydration or
 *   router.refresh() (templates only remount on navigation), and transforms/filters/clips are removed when done.
 */

interface Origin { x: number; y: number; clip: string; at: number }
let origin: Origin | null = null;
/** Centre of the last pressed control (viewport px) — dialogs/sheets grow from it */
let lastPress: { x: number; y: number; at: number } | null = null;

export function pressOrigin(maxAgeMs = 1200) {
  return lastPress && performance.now() - lastPress.at < maxAgeMs ? lastPress : null;
}
let hydrated = false;
const FRESH_MS = 1500;

const root = () => document.querySelector<HTMLElement>("[data-page-root]");

function record(el: Element) {
  const page = root();
  if (!page) return;
  const r = el.getBoundingClientRect();
  const p = page.getBoundingClientRect();
  // The new page renders scrolled to the top, with its root where this page's root starts in the document; the
  // pressed element stays where it is on screen. So: on-screen centre minus the root's document offset.
  const rootTop = p.top + window.scrollY;
  const x = r.left + r.width / 2 - p.left;
  const y = r.top + r.height / 2 - rootTop;
  // Start clip: the pressed element's box (at least 56px), clamped into the page box
  const half = Math.max(28, Math.max(r.width, r.height) / 2);
  const l = Math.max(0, x - half), t = Math.max(0, y - half);
  const rr = Math.max(0, p.width - (x + half));
  const clip = `${t}px ${rr}px calc(100% - ${y + half}px) ${l}px`;
  origin = { x, y, clip, at: performance.now() };
  const s = document.documentElement.style;
  s.setProperty("--open-x", `${x}px`);
  s.setProperty("--open-y", `${y}px`);
  s.setProperty("--open-clip", clip);
  s.setProperty("--open-scale", String(OPEN.scale));
}

function resetVars() {
  const s = document.documentElement.style;
  ["--open-x", "--open-y", "--open-clip", "--open-scale"].forEach((k) => s.removeProperty(k));
}

function takeOrigin(): Origin | null {
  const o = origin && performance.now() - origin.at < FRESH_MS ? origin : null;
  origin = null;
  return o;
}

export const supportsViewTransitions = () => typeof document !== "undefined" && "startViewTransition" in document;

/** Global click capture: any same-site link to another page records its origin. Opt out with data-no-app-open. */
export function AppOpenTracker() {
  useEffect(() => {
    hydrated = true;
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.closest("[data-no-app-open]")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      record(a.closest("[data-app-open]") ?? a);
    };
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("a,button,[role=button],[role=menuitem]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      lastPress = { x: r.left + r.width / 2, y: r.top + r.height / 2, at: performance.now() };
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, []);
  return null;
}

type Mode = "none" | "vt" | "fm";

/** Route template wrapper. Hydration render is always "none" so server and client markup match. */
export function PageTransition({ children }: { children: ReactNode }) {
  const { level } = useEffects();
  const [mode] = useState<Mode>(() => (!hydrated || level === "off" ? "none" : supportsViewTransitions() ? "vt" : "fm"));
  const [from] = useState(() => (mode === "none" ? null : takeOrigin()));

  useEffect(() => {
    if (mode === "none") return;
    const id = window.setTimeout(resetVars, 700);
    return () => window.clearTimeout(id);
  }, [mode]);

  if (mode === "vt") {
    return (
      <ViewTransition enter="app-open" default="none">
        <div data-page-root>{children}</div>
      </ViewTransition>
    );
  }
  if (mode === "fm") {
    const full = level === "full";
    return (
      <motion.div
        data-page-root
        style={{ transformOrigin: from ? `${from.x}px ${from.y}px` : "50% 0px" }}
        initial={
          full && from
            ? { opacity: 0, scale: OPEN.scale, filter: `blur(${OPEN.blur}px)`, clipPath: `inset(${from.clip} round ${OPEN.radius}px)` }
            : full ? { opacity: 0, scale: 0.985, filter: "blur(4px)" } : { opacity: 0 }
        }
        // Clear transform/filter/clip once settled: they would otherwise trap fixed descendants and clip overlays
        animate={
          full
            ? { opacity: 1, scale: 1, filter: "blur(0px)", clipPath: `inset(0px 0px 0px 0px round 0px)`, transitionEnd: { filter: "none", clipPath: "none", transform: "none" } }
            : { opacity: 1 }
        }
        transition={{ ...SPRING.open, opacity: { duration: 0.18 }, filter: { duration: 0.3 } }}
      >
        {children}
      </motion.div>
    );
  }
  return <div data-page-root>{children}</div>;
}
